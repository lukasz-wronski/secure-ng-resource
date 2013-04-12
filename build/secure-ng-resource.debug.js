/***********************************************
* secure-ng-resource JavaScript Library
* https://github.com/davidmikesimon/secure-ng-resource/ 
* License: MIT (http://www.opensource.org/licenses/mit-license.php)
* Compiled At: 04/12/2013 12:19
***********************************************/
(function(window) {
'use strict';
angular.module('secureNgResource', [
    'ngResource',
    'ngCookies'
]);

'use strict';

angular.module('secureNgResource')
.factory('passwordOAuth', [
'$http',
function($http) {
    var PasswordOAuth = function (clientId, clientSecret) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    };

    var encodeURIForm = function (params) {
        var s = '';
        angular.forEach(params, function(val, key) {
            if (s.length > 0) { s += '&'; }
            s += key + '=' + encodeURIComponent(val);
        });
        return s;
    };

    PasswordOAuth.prototype = {
        checkLogin: function (host, credentials, handler) {
            $http({
                method: 'POST',
                url: host + '/oauth/v2/token',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                data: encodeURIForm({
                    'client_id': this.clientId,
                    'client_secret': this.clientSecret,
                    'grant_type': 'password',
                    'username': credentials.user,
                    'password': credentials.pass
                })
            }).then(function(response) {
                if (
                response.status === 200 &&
                angular.isString(response.data['access_token'])
                ) {
                    var d = response.data;
                    handler({
                        status: 'accepted',
                        newState: {
                            user: credentials.user,
                            accessToken: d['access_token'],
                            accessTokenExpires:
                                new Date().getTime() + d['expires_in'],
                            refreshToken: d['refresh_token']
                        }
                    });
                } else if (
                response.status === 400 &&
                response.data.error === 'invalid_grant'
                ) {
                    handler({
                        status: 'denied',
                        msg: 'Invalid username or password'
                    });
                } else {
                    var msg = 'HTTP Status ' + response.status;
                    if (response.status === 0) {
                        msg = 'Unable to connect to authentication server';
                    } else if (response.data['error_description']) {
                        msg = 'OAuth:' + response.data['error_description'];
                    }
                    handler({
                        status: 'error',
                        msg: msg
                    });
                }
            });
        },

        addAuthToRequest: function (httpConf, state) {
            httpConf.headers.Authorization = 'Bearer ' + state.accessToken;
        },

        isAuthFailure: function (response) {
            return (response.status === 401);
        }
    };

    var PasswordOAuthFactory = function(clientId, clientSecret) {
        return new PasswordOAuth(clientId, clientSecret);
    };
    return PasswordOAuthFactory;
}]);

'use strict';

angular.module('secureNgResource')
.factory('secureResource', [
'$resource', function($resource) {
    var DEFAULT_ACTIONS = {
        'get':    {method:'GET'},
        'save':   {method:'POST'},
        'query':  {method:'GET', isArray:true},
        'remove': {method:'DELETE'},
        'delete': {method:'DELETE'}
    };

    return function(session, path, paramDefaults, actions) {
        var fullActions = angular.extend({}, DEFAULT_ACTIONS, actions);
        angular.forEach(fullActions, function(httpConf) {
            // FIXME This will stop working when token changes!
            // Update as needed from session, tracking resource by path
            session.updateRequest(httpConf);
        });

        // Escape the colon before a port number, it confuses ngResource
        var host = session.getHost().replace(/(:\d+)$/g, '\\$1');
        var res = $resource(host + path, paramDefaults, fullActions);

        return res;
    };
}]);

'use strict';

angular.module('secureNgResource')
.factory('session', [
'$q', '$location', '$cookieStore', 'sessionDictionary',
function($q, $location, $cookieStore, sessionDictionary) {
    var DEFAULT_SETTINGS = {
        sessionName: 'angular',
        loginPath: '/login',
        defaultPostLoginPath: '/'
    };

    var Session = function (host, auth, settings) {
        this.host = host;
        this.auth = auth;
        this.settings = angular.extend(
            {},
            DEFAULT_SETTINGS,
            settings
        );

        this.priorPath = null;
        this.state = null;

        sessionDictionary[this.cookieKey()] = this;
        var cookie = $cookieStore.get(this.cookieKey());
        if (cookie) {
            this.state = cookie;
        } else {
            this.reset();
        }
    };
    
    Session.prototype = {
        getUserName: function () {
            if (this.loggedIn()) {
                return this.state.user;
            }
        },

        loggedIn: function () {
            // TODO Check for timeout
            return this.state !== null;
        },

        login: function (credentials, callbacks) {
            var me = this;
            var handler = function(result) {
                if (angular.isObject(callbacks) && callbacks[result.status]) {
                    callbacks[result.status](result);
                }

                if (result.status === 'accepted') {
                    me.state = result.newState;
                    $cookieStore.put(me.cookieKey(), me.state);
                    var tgt = me.settings.defaultPostLoginPath;
                    if (me.priorPath !== null) { tgt = me.priorPath; }
                    $location.path(tgt).replace();
                }
            };

            this.auth.checkLogin(this.host, credentials, handler);
        },

        logout: function () {
            if (this.loggedIn()) {
                this.reset();
                $location.path(this.settings.loginPath);
            }
        },

        reset: function () {
            this.state = null;
            $cookieStore.remove(this.cookieKey());
        },

        cookieKey: function () {
            return this.settings.sessionName + '-' +
                encodeURIComponent(this.host);
        },

        updateRequest: function(httpConf) {
            if (this.loggedIn()) {
                if (!httpConf.headers) { httpConf.headers = {}; }
                this.auth.addAuthToRequest(httpConf, this.state);
            }
            httpConf.sessionDictKey = this.cookieKey();
        },

        handleHttpFailure: function(response) {
            if (this.auth.isAuthFailure(response)) {
                this.reset();
                this.priorPath = $location.path();
                $location.path(this.settings.loginPath).replace();
                return $q.reject(response);
            } else {
                return response;
            }
        }
    };

    var SessionFactory = function(host, auth, settings) {
        return new Session(host, auth, settings);
    };
    return SessionFactory;
}]);

'use strict';

angular.module('secureNgResource')
.factory('sessionDictionary', [
function () {
    return {};
}]);

'use strict';

angular.module('secureNgResource').config([
'$httpProvider',
function($httpProvider) {
    $httpProvider.responseInterceptors.push([
    'sessionDictionary',
    function(sessionDictionary) {
        return function(promise) {
            return promise.then(function (response) {
                // Success
                return response;
            }, function (response)  {
                // Failure
                var ses = sessionDictionary[response.config.sessionDictKey];
                if (ses) {
                    return ses.handleHttpFailure(response);
                } else {
                    // Let someone else deal with this problem
                    return response;
                }
            });
        };
    }]);
}]);

}(window));