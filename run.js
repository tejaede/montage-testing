//
//
//

global.createJavaScriptContext = function createJavaScriptContext() {
    var iframe = document.createElement("iframe"),
        context = {};

    iframe.style.display = "none";
    document.body.appendChild(iframe);
    ["Object", "String", "Number", "RegExp", "Array", "Boolean"]
    .forEach(function (key) {
        context[key] = iframe.contentWindow[key];
    });
    context.document = iframe.contentDocument;
    iframe.parentNode.removeChild(iframe);

    return context;
}

global.waitsThen = function waitsThen(promise, resolved) {
    waitsFor(function () {
        return promise.isResolved();
    }, "promise", 500);
    runs(function () {
        resolved(promise.valueOf());
    })
}

global.expectationToDispatch = function expectationToDispatch(object, expectation, handleEvent) {

    var handler = {
        handleEvent: handleEvent? handleEvent : function (event) {}
    };

    if (typeof expectation === "string") {
        // expect event name
        spyOn(handler, "handleEvent").andCallThrough();
        object.addEventListener(expectation, handler, false);
    }

    return function (negate) {
        if (negate) {
            expect(handler.handleEvent).not.toHaveBeenCalled();
        } else {
            expect(handler.handleEvent).toHaveBeenCalled();
        }
    }
}

global.addMontageMetadataToProto = function (objectName, moduleId, proto) {
    Object.defineProperty(proto, "_montage_metadata", { value: { moduleId: moduleId, objectName: objectName, isInstance: false }, enumerable: false});
};


global.expectConsoleCallsFrom = function expectConsoleCallsFrom(procedure, global, logLevel) {
    logLevel = logLevel ? logLevel : "log";
    var old = global.console[logLevel];
    var spy = jasmine.createSpy(logLevel + "-spy");

    global.console[logLevel] = spy;
    procedure();
    global.console[logLevel] = old;

    return expect(spy);
};

global.queryString = function queryString(parameter) {
    var i, key, value, equalSign;
    var params = [];

    for (i=0; i<params.length;i++) {
        equalSign = params[i].indexOf('=');
        if (equalSign < 0) {
            key = params[i];
            if (key == parameter) {
                value = true;
                break;
            }
        }
        else {
            key = params[i].substring(0, equalSign);
            if (key == parameter) {
                value = params[i].substring(equalSign+1);
                break;
            }
        }
    }
    return value;
}

exports.run = function run( suiteRequire, modules) {
    var spec = global.queryString("spec");

    // Filter node:false
    modules = modules.filter(function (module) {
        if (typeof module === "object") {
            if (module.node === false && typeof process !== "undefined") {
                return false;
            }
        }
        return true;
    }).map(function (module) {
        if (typeof module === "object") {
            return module.name;
        } else {
            return module;
        }
    });

    if (spec) {
        return suiteRequire.async(decodeURIComponent(spec)).then(function() {
            jasmine.getEnv().execute();
        });
    } else {
        return Promise.all(modules.map(suiteRequire.deepLoad)).then(function () {
            modules.forEach(suiteRequire);
        }).then(function() {
            if (global.__karma__) {
                global.__karma__.start();
            } else {
                jasmine.getEnv().execute();    
            }
        });
    }
}