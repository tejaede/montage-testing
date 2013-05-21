/**
 * @see https://developer.mozilla.org/en/DOM/HTMLIFrameElement
 */
var Montage = require("montage").Montage;
var dom = require("montage/core/dom");
var URL = require("montage/core/url");
var ActionEventListener = require("montage/core/event/action-event-listener").ActionEventListener;
var MutableEvent = require("montage/core/event/mutable-event").MutableEvent;
var Promise = require("montage/core/promise").Promise;
var defaultEventManager;


var TestPageLoader = exports.TestPageLoader = Montage.create(Montage, {
    init: {
        enumerable: false,
        value: function() {
            if (typeof window.testpage === "undefined") {
                if (!this.iframe) {
                    this.iframe = document.createElement("iframe");
                    this.iframe.id = "testpage";
                    document.body.appendChild(this.iframe);
                }
                window.testpage = this;
                this.loaded = false;
                return this;
            } else {
                return window.testpage;
            }
        }
    },

    iframeSrc: {
        value: null
    },

    drawHappened: {
        value: false
    },

    willNeedToDraw: {
        value: false
    },

    testQueue: {
        value: []
    },

    loading: {
        value: false
    },

    options: {
        value: function(testName, options) {
            var callback = arguments[2];
            if (typeof options === "function") {
                options = { callback: options};
            } else {
                if (options == null) {
                    options = {};
                }
                options.callback = callback;
            }
            options.testName = testName;
            // FIXME Hack to get current directory
            var dir;
            if (this.options.caller.caller.arguments
                    && this.options.caller.caller.arguments[2]
                    && this.options.caller.caller.arguments[2].directory) {
                dir = this.options.caller.caller.arguments[2].directory
            } else {
                dir = this.options.caller.caller.caller.arguments[2].directory
            }
            options.directory = dir;

            return options;
        }
    },

    testPage: {
        get: function() {
            var testPage = window.testpage;
            if (!testPage) {
                testPage = TestPageLoader.create().init();
            }
            return testPage;
        }
    },

    queueTest: {
        value: function(testName, options, callback) {
            console.log("TestPageLoader.queueTest() - " + testName);
            testPage = TestPageLoader.testPage;
            options = testPage.options(testName, options, callback);

            describe(testName, function() {
                it("should load", function() {
                   console.group(testName);
                   return testPage.loadTest(testPage.loadFrame(options), options).then(function(theTestPage) {
                       expect(theTestPage.loaded).toBe(true);
                   });
                });
                // add the rest of the assertions
                options.callback(testPage);
                it("should unload", function() {
                   testPage.unloadTest();
                   console.groupEnd();
                });
            });


            //testPage.testQueue.push(options);
            //return testPage;
        }
    },

    endTest: {
        value: function() {
            this.loading = false;
            this.callNext();
        }
    },

    callNext: {
        value: function() {
            if (!this.loading && this.testQueue.length !== 0) {
                var self = this;
                this.unloadTest();
                setTimeout(function() {
                    self.loadTest(self.testQueue.shift());
                    self.loading = true;
                }, 0);
            }
        }
    },

    loadTest: {
        value: function(promiseForFrameLoad, test) {
            var pageFirstDraw = Promise.defer();
            var testName = test.testName,
                testCallback = test.callback,
                timeoutLength = test.timeoutLength,
                self = this,
                src;

            if (!timeoutLength) {
                timeoutLength = 10000;
            }

            this.loaded = false;
            //
            promiseForFrameLoad.then( function(frame) {
                // implement global function that montage is looking for at load
                // this is little bit ugly and I'd like to find a better solution
                self.window.montageWillLoad = function() {
                    var firstDraw = true;
                    this.window.montageRequire.async("ui/component")
                    .then(function (COMPONENT) {
                        var root = COMPONENT.__root__;
                        self.rootComponent = root;
                        // override the default drawIfNeeded behaviour
                        var originalDrawIfNeeded = root.drawIfNeeded;
                        root.drawIfNeeded = function() {

                            var continueDraw = function() {
                                originalDrawIfNeeded.call(root);
                                self.drawHappened++;
                                if(firstDraw) {
                                    self.loaded = true;
                                    // assign the application delegate to test so that the convenience methods work
                                    if (! self.window.test && self.window.require("montage/core/application").application) {
                                        self.window.test = self.window.require("montage/core/application").application.delegate;
                                    }
                                    if (typeof testCallback === "function") {
                                        if (test.firstDraw) {
                                            pageFirstDraw.resolve(self);
                                        } else {
                                            // francois HACK
                                            // not sure how to deal with this
                                            // if at first draw the page isn't complete the tests will fail
                                            // so we wait an arbitrary 100ms for subsequent draws to happen...
                                            setTimeout(function() {
                                                pageFirstDraw.resolve(self);
                                            }, 100);
                                        }
                                    }
                                    firstDraw = false;
                                }
                                if (self._drawHappened) {
                                    self._drawHappened();
                                }
                            };

                            var pause = queryString("pause");
                            if (firstDraw && decodeURIComponent(pause) === "true") {
                                var handleKeyUp = function(event) {
                                    if (event.which === 82) {
                                        self.document.removeEventListener("keyup", handleKeyUp,false);
                                        document.removeEventListener("keyup", handleKeyUp,false);
                                        continueDraw();
                                    }
                                };
                                self.document.addEventListener("keyup", handleKeyUp,false);
                                document.addEventListener("keyup", handleKeyUp,false);
                            } else {
                                continueDraw();
                            }


                            self.willNeedToDraw = false;
                        };
                        var originalAddToDrawList = root._addToDrawList;
                        root._addToDrawList = function(childComponent) {
                            originalAddToDrawList.call(root, childComponent);
                            self.willNeedToDraw = true;
                        };

                        defaultEventManager = null;

                        return this.window.montageRequire.async("core/event/event-manager")
                        .then(function (exports) {
                            defaultEventManager = exports.defaultEventManager;
                        });

                    })
                    .done();
                };
            });


            var promiseForTestPage = pageFirstDraw.promise.timeout(timeoutLength);
            return promiseForTestPage
                .then(function(self) {
                    return self;
                })
                .fail(function(reason) {
                    console.error(testName + " - " + reason.message);
                    return self;
                })
         }
    },

    loadFrame: {
        value: function(options) {
            var self = this, src;
            var frameLoad = Promise.defer();
            var callback = function() {
                frameLoad.resolve(self.window);
                if (self.testWindow) {
                    self.testWindow.removeEventListener("load", callback, true);
                } else {
                    self.iframe.removeEventListener("load", callback, true);
                }
            }
            if (options.src) {
                src = "../test/" + options.src;
            } else {
                src = URL.resolve(options.directory, options.testName + ".html");
            }
            if (options.newWindow) {
                self.testWindow = window.open(src, "test-window");
                window.addEventListener("unload", function() {
                    self.unloadTest(testName);
                }, false);
                self.testWindow.addEventListener("load", callback, true);
            } else {
                self.iframe.src = src;
                self.iframe.addEventListener("load", callback, true);
            }
            return frameLoad.promise;
        }
    },

    unloadTest: {
        enumerable: false,
        value: function(testName) {
            this.loaded = false;
            if (this.testWindow) {
                this.testWindow.close();
                this.testWindow = null;
            } else {
                this.iframe.src = "";
            }
            return this;
        }
    },

    nextDraw: {
        value: function(numDraws, forceDraw) {
            var theTestPage = this,
                deferred = Promise.defer();

            this.drawHappened = false;

            if (!numDraws) {
                numDraws = 1;
            }

            theTestPage._drawHappened = function() {
                if(theTestPage.drawHappened == numDraws) {
                    deferred.resolve(numDraws);
                    theTestPage._drawHappened = null;
                }
            }
            if(forceDraw) {
                this.rootComponent.drawTree();
            }
            return deferred.promise.timeout(1000);
        }
    },

    waitForDraw: {
        value: function(numDraws, forceDraw) {
            var theTestPage = this;
            this.drawHappened = false;

            if (!numDraws) {
                numDraws = 1;
            }

            waitsFor(function() {
                return theTestPage.drawHappened == numDraws;
            }, "component drawing",1000);
            if(forceDraw) {
                this.rootComponent.drawTree();
            }
        }
    },

    waitForComponentDraw: {
        value: function(component, numDraws, forceDraw) {
            if (!numDraws) {
                numDraws = 1;
            }

            var currentDraw = component.draw;

            if (!currentDraw.oldDraw) {
                component.draw = function draw() {
                    draw.drawHappened++;
                    return draw.oldDraw.apply(this, arguments);
                }
                component.draw.oldDraw = currentDraw;
            }
            component.draw.drawHappened = 0;

            waitsFor(function() {
                return component.draw.drawHappened == numDraws;
            }, "component drawing",1000);
            if(forceDraw) {
                this.rootComponent.drawTree();
            }
        }
    },

    getElementById: {
        enumerable: false,
        value: function(elementId) {
            return this.document.getElementById(elementId);
        }
    },

    querySelector: {
        enumerable: false,
        value: function(selector) {
            return this.document.querySelector(selector);
        }
    },

    querySelectorAll: {
        enumerable: false,
        value: function(selector) {
            return this.document.querySelectorAll(selector);
        }
    },

    test: {
        enumerable: false,
        get: function() {
            return this.window.test;
        }
    },

    document: {
        get: function() {
            if (this.testWindow) {
                return this.testWindow.document;
            } else {
                return this.iframe.contentDocument;
            }
        }
    },

    window: {
        get: function() {
            if (this.testWindow) {
                return this.testWindow;
            } else {
                return this.iframe.contentWindow;
            }
        }
    },

    addListener: {
        value: function(component, fn, type) {
            type = type || "action";
            var buttonSpy = {
                doSomething: fn || function(event) {
                    return 1+1;
                }
            };
            spyOn(buttonSpy, 'doSomething');

            var actionListener = Montage.create(ActionEventListener).initWithHandler_action_(buttonSpy, "doSomething");
            component.addEventListener(type, actionListener);

            return buttonSpy.doSomething;
        }
    },

    keyEvent: {
        enumerable: false,
        value: function(eventInfo, eventName, callback) {
            if (!eventName) {
                eventName = "keypress";
            }
            eventInfo.modifiers = eventInfo.modifiers || "";
            eventInfo.keyCode = eventInfo.keyCode || 0;
            eventInfo.charCode = eventInfo.charCode || 0;

            var doc = this.iframe.contentDocument,
                mofifiers = eventInfo.modifiers.split(" "),
                    event = {
                    altGraphKey: false,
                    altKey: mofifiers.indexOf("alt") !== -1,
                    bubbles: true,
                    cancelBubble: false,
                    cancelable: true,
                    charCode: eventInfo.charCode,
                    clipboardData: undefined,
                    ctrlKey: mofifiers.indexOf("control") !== -1,
                    currentTarget: null,
                    defaultPrevented: false,
                    detail: 0,
                    eventPhase: 0,
                    keyCode: eventInfo.keyCode,
                    layerX: 0,
                    layerY: 0,
                    metaKey: mofifiers.indexOf("meta") !== -1,
                    pageX: 0,
                    pageY: 0,
                    returnValue: true,
                    shiftKey: mofifiers.indexOf("shift") !== -1,
                    srcElement: eventInfo.target,
                    target: eventInfo.target,
                    timeStamp: new Date().getTime(),
                    type: eventName,
                    view: doc.defaultView,
                    which: eventInfo.charCode || eventInfo.keyCode
                    },
                targettedEvent = MutableEvent.fromEvent(event);

            defaultEventManager.handleEvent(targettedEvent);

            if (typeof callback === "function") {
                if(this.willNeedToDraw) {
                    this.waitForDraw();
                    runs(callback);
                } else {
                    callback();
                }
            }
            return eventInfo;
        }
    },

    mouseEvent: {
        enumerable: false,
        value: function(eventInfo, eventName, callback) {
            if (!eventName) {
                eventName = "click";
            }
            eventInfo.clientX = eventInfo.clientX || eventInfo.target.offsetLeft;
            eventInfo.clientY = eventInfo.clientY || eventInfo.target.offsetTop;

            var doc = this.iframe.contentDocument,
                event = doc.createEvent('MouseEvents');

            event.initMouseEvent(eventName, true, true, doc.defaultView,
                null, null, null, eventInfo.clientX, eventInfo.clientY,
                false, false, false, false,
                0, null);
            eventInfo.target.dispatchEvent(event);
            if (typeof callback === "function") {
                if(this.willNeedToDraw) {
                    this.waitForDraw();
                    runs(callback);
                } else {
                    callback();
                }
            }
            return eventInfo;
        }
    },

    touchEvent: {
        enumerable: false,
        value: function(eventInfo, eventName, callback) {
            if (!eventName) {
                eventName = "touchstart";
            }
            var doc = this.document,
                simulatedEvent = doc.createEvent("CustomEvent"),
                touch;


            if (typeof eventInfo.touches !== "undefined") {
                // if you have a touches array we assume you know what you are doing
                simulatedEvent.initEvent(eventName, true, true, doc.defaultView, 1, null, null, null, null, false, false, false, false, 0, null);
                simulatedEvent.touches = eventInfo.touches;
                simulatedEvent.targetTouches = eventInfo.targetTouches;
                simulatedEvent.changedTouches = eventInfo.changedTouches;
            } else {
                touch = {};
                touch.clientX = eventInfo.clientX || eventInfo.target.offsetLeft;
                touch.clientY = eventInfo.clientY || eventInfo.target.offsetTop;
                touch.target = eventInfo.target;
                touch.identifier = eventInfo.identifier || 500;
                simulatedEvent.initEvent(eventName, true, true, doc.defaultView, 1, null, null, null, null, false, false, false, false, 0, null);
                simulatedEvent.touches = [touch];
                simulatedEvent.targetTouches = [touch];
                simulatedEvent.changedTouches = [touch];
            }


            eventInfo.target.dispatchEvent(simulatedEvent);
            if (typeof callback === "function") {
                if(this.willNeedToDraw) {
                    this.waitForDraw();
                    runs(callback);
                } else {
                    callback();
                }
            }
            return eventInfo;
        }
    },

    clickOrTouch: {
        enumerable: false,
        value: function(eventInfo, callback) {
            if (window.Touch) {
                this.touchEvent(eventInfo, "touchstart");
                this.touchEvent(eventInfo, "touchend");
                this.mouseEvent(eventInfo, "click");
            } else {
                this.mouseEvent(eventInfo, "mousedown");
                this.mouseEvent(eventInfo, "mouseup");
                this.mouseEvent(eventInfo, "click");
            }
            if (typeof callback === "function") {
                if(this.willNeedToDraw) {
                    this.waitForDraw();
                    runs(callback);
                } else {
                    callback();
                }
            }
            return eventInfo;
        }
    },

    dragElementOffsetTo: {
        enumerable: false,
        value: function(element, offsetX, offsetY, startCallback, moveCallback, endCallback, options) {
            var self = this;
            var startEventName = "mousedown";
            var moveEventName = "mousemove";
            var endEventName = "mouseup";
            var eventFactoryName = "mouseEvent";

            if (options) {
                if(options.pointerType === "touch" || window.Touch) {
                    startEventName = "touchstart";
                    moveEventName = "touchmove";
                    endEventName = "touchend";
                    eventFactoryName = "touchEvent";
                }
            }

            // mousedown
            self.mouseEvent({target: element}, startEventName);

            if (startCallback) {
                startCallback();
            }

            // Mouse move doesn't happen instantly
            waits(10);
            runs(function() {
                var ax = element.offsetLeft + offsetX/2,
                ay = element.offsetTop + offsetY/2,
                bx = element.offsetLeft + offsetX,
                by = element.offsetTop + offsetY;

                // Do two moves to be slightly realistic
                self[eventFactoryName]({
                    target: element,
                    clientX: ax,
                    clientY: ay
                }, moveEventName);

                var eventInfo = self[eventFactoryName]({
                    target: element,
                    clientX: bx,
                    clientY: by
                }, moveEventName);

                if (moveCallback) {
                    moveCallback();
                }

                // mouse up
                self[eventFactoryName](eventInfo, endEventName);

                if (endCallback) {
                    endCallback();
                }
            });
        }
    },

    fireEventsOnTimeline: {
        value: function(timeline, callback) {
            var i, j, stepKey;
            for (i = 0; i < timeline.length; i++) {
                var line = timeline[i];
                // keep initial values that we increment later
                var clientX = line.target.offsetLeft;
                var clientY = line.target.offsetTop;
                for (j = 0; j < line.steps.length; j++) {
                    var step = line.steps[j];
                    var time = step.time;
                    delete step.time;
                    var eventInfo = {
                        type: line.type,
                        target: line.target,
                        identifier: line.identifier
                    };
                    for (stepKey in step) {
                        if(stepKey.indexOf(line.type) !== -1) {
                            eventInfo.eventType = stepKey;
                            var typeInfo = step[stepKey];
                            if (typeInfo) {
                                eventInfo.clientX = clientX = clientX + typeInfo.dx;
                                eventInfo.clientY = clientY = clientY + typeInfo.dy;
                            }
                        } else {
                            eventInfo[key] = step[stepKey];
                        }
                    }
                    console.log("_scheduleEventForTime", eventInfo)
                    this._scheduleEventForTime(eventInfo, time, callback);
                }
            }
        }
    },

    _nextStepTime: {
        value: 0
    },

    _eventsInOrder: {
        value: null
    },

    _scheduleEventForTime: {
        value: function(eventInfo, t, callback) {
            var self = this;
            if(!self._eventsInOrder) {
                self._eventsInOrder = [];
                self._touchesInProgress = [];
                var foo = function() {
                    waits(10);
                    runs(function() {
                        console.log("********** nextStepTime:" + self._nextStepTime + " **********");
                        var events = self._eventsInOrder[self._nextStepTime];
                        while(!events || self._eventsInOrder.length === self._nextStepTime) {
                            self._nextStepTime++;
                            console.log("********** nextStepTime:" + self._nextStepTime + " **********");
                            events = self._eventsInOrder[self._nextStepTime];
                        }
                        self._dispatchScheduledEvents(events);
                        callback(self._nextStepTime);
                        self._nextStepTime++;
                        if(self._eventsInOrder.length > self._nextStepTime) {
                            // while we have more events in the time line keep going.
                            foo();
                        }
                    });
                };
                foo();
            }
            if(self._eventsInOrder[t]) {
                self._eventsInOrder[t].push(eventInfo);
            } else {
                self._eventsInOrder[t] = [eventInfo];
            }
        }
    },

    _touchesInProgress: {
        value: null
    },
    
    _dispatchScheduledEvents: {
        value: function(eventFragments) {
            var i, eventInfos = {}, eventInfo;
            for (i = 0; i < eventFragments.length; i++) {
                var pointer = eventFragments[i];
                if(pointer.type === "touch") {
                    if(pointer.eventType === "touchstart") {
                        this._touchesInProgress.push(pointer);
                    } else if(pointer.typeName === "touchend") {
                        this._touchesInProgress.splice(this._touchesInProgress.indexOf(pointer),1);
                    }
                    if(eventInfo = eventInfos[pointer.eventType]) {
                        // if the event is already initialized all we need to do is add to the changedTouches.
                        eventInfo.changedTouches.push(pointer);
                    } else {
                        eventInfo = {};
                        eventInfo.target = pointer.target;
                        eventInfo.changedTouches = [pointer];
                        eventInfos[pointer.eventType] = eventInfo;
                    }
                } else {
                    // mouse event
                    this.mouseEvent(pointer, pointer.eventType);
                }
            }
            // at the end we know all the touches
            for(var eventType in eventInfos) {
                eventInfo = eventInfos[eventType];
                eventInfo.touches = this._touchesInProgress;
                // this is not strictly correct
                eventInfo.targetTouches = eventInfo.changedTouches;
                this.touchEvent(eventInfo, eventType);
            }
        }
    },

    evaluateNode: {
        enumerable: false,
        value: function(xpathExpression, contextNode, namespaceResolver, resultType, result) {
            if (!contextNode) {
                contextNode = this.document;
            }
            if (!resultType) {
                resultType = XPathResult.FIRST_ORDERED_NODE_TYPE;
            }

            var pathResult = this.iframe.contentDocument.evaluate(xpathExpression, contextNode, namespaceResolver, resultType, result);
            if (pathResult) {
                switch (pathResult.resultType) {
                    case XPathResult.NUMBER_TYPE:
                        return pathResult.numberValue;
                    case XPathResult.BOOLEAN_TYPE:
                        return pathResult.booleanValue;
                    case XPathResult.STRING_TYPE:
                        return pathResult.stringValue;
                    default:
                        return pathResult.singleNodeValue;
                }
            }
        }
    },

    evaluateBoolean: {
        enumerable: false,
        value: function(xpathExpression) {
            return this.evaluateNode(xpathExpression, null, null, XPathResult.BOOLEAN_TYPE, null);
        }
    },

    evaluateNumber: {
        enumerable: false,
        value: function(xpathExpression) {
            return this.evaluateNode(xpathExpression, null, null, XPathResult.NUMBER_TYPE, null);
        }
    },

    evaluateString: {
        enumerable: false,
        value: function(xpathExpression) {
            return this.evaluateNode(xpathExpression, null, null, XPathResult.STRING_TYPE, null);
        }
    },

    handleEvent: {
        enumerable: false,
        value: function(event) {
            if (this[event.type]) {
                this[event.type](event);
            }
        }
    },

    loaded: {
        value: false
    },

    iframe: {
        value: null
    },

    testWindow: {
        value: null
    }
});

var EventInfo = exports.EventInfo = Montage.create(Montage, {

    target: {
        value: null
    },

    clientX: {
        value: null
    },

    clientY: {
        value: null
    },

    pageX: {
        value: null
    },

    pageY: {
        value: null
    },

    initWithElement: {
        value: function(element) {
            if (element != null) {
                this.target = element;

                var elementDelta = this.positionOfElement(element);
                this.clientX = elementDelta.x + element.offsetWidth / 2;
                this.clientY = elementDelta.y + element.offsetHeight / 2;
                this.pageX = elementDelta.x + element.offsetWidth / 2;
                this.pageY = elementDelta.y + element.offsetHeight / 2;

            } else {
                 this.target =  window.testpage.window.document;
            }
            return this;
        }
    },

    initWithSelector: {
        value: function(selector) {
            var element = this.querySelector(selector);
            return this.initWithElement(element);
       }
    },

    initWithElementAndPosition: {
        value: function(element, x, y) {
            this.initWithElement(element);
            this.clientX = x;
            this.clientY = y;
            return this;
        }
    },

    positionOfElement: {
        value: function(element) {
            return dom.convertPointFromNodeToPage(element);
        }
    },

    move: {
        value: function(x, y) {
            if (x) {
                this.clientX += x;
                this.pageX += x;
            }
            if (y) {
                this.clientY += y;
                this.pageY += y;
            }
        }
    },

    testPageLoader: {
        value: null
    }

});


window.loaded = function() {
    window.testpage.loaded = true;
};
