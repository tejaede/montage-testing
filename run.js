var Promise = require("bluebird");

exports.run = function (suiteRequire, modules) {
    var spec = queryString("spec");

    if (spec) {
        suiteRequire.async(decodeURIComponent(spec))
            .then(function () {
                jasmine.getEnv().execute();
            });

    } else {
        Promise.all(modules.map(suiteRequire.deepLoad))
            .then(function () {
                modules.forEach(suiteRequire);
                jasmine.getEnv().execute();
            })
            .then(function () {
                if (window.__testacular__) {
                    window.__testacular__.loaded();
                }
            });
    }
};

var jasmineEnv = jasmine.getEnv();

jasmineEnv.updateInterval = 1000;

if (jasmine.HtmlReporter) {
    jasmineEnv.addReporter(new jasmine.HtmlReporter());
}

if (jasmine.JsApiReporter) {
    jasmineEnv.addReporter(new jasmine.JsApiReporter());
}

if (jasmine.JSReporter) {
    jasmineEnv.addReporter(new jasmine.JSReporter());
}
