/***********************************************
* secure-ng-resource JavaScript Library
* https://github.com/davidmikesimon/secure-ng-resource/ 
* License: MIT (http://www.opensource.org/licenses/mit-license.php)
* Compiled At: 06/27/2013 14:57
***********************************************/
(function(window) {
'use strict';
angular.module('secureNgResource', [
    'ngResource',
    'ngCookies'
]);

'use strict';

angular.module('secureNgResource')
.factory('authSession', [
'$q', '$location', '$cookieStore', '$injector', '$rootScope', '$timeout',
function($q, $location, $cookieStore, $injector, $rootScope, $timeout) {
    var DEFAULT_SETTINGS = {
        sessionName: 'angular',
        loginPath: '/login',
        logoutUrl: null,
        defaultPostLoginPath: '/'
    };

    var sessionDictionary = {};

    var AuthSession = function (auth, settings) {
        this.auth = auth;
        this.settings = angular.extend(
            {},
            DEFAULT_SETTINGS,
            settings
        );

        this.priorPath = null;
        this.state = null;
        this.managedHttpConfs = [];
        this.refreshPromise = null;

        sessionDictionary[this.cookieKey()] = this;
        var cookie = $cookieStore.get(this.cookieKey());
        if (cookie) {
            this.state = cookie;
        } else {
            this.reset();
        }
    };
    
    AuthSession.prototype = {
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
            this.auth.checkLogin(credentials, function(result) {
                if (result.status === 'accepted') {
                    me.state = result.newState;
                    // FIXME This is silly
                    if (!('user' in me.state)) {
                        me.state.user = credentials.user;
                    }
                    me._onStateChange();

                    var tgt = me.settings.defaultPostLoginPath;
                    if (me.priorPath !== null) { tgt = me.priorPath; }
                    $location.path(tgt).replace();
                }

                if (angular.isObject(callbacks) && callbacks[result.status]) {
                    callbacks[result.status](result);
                }

                if (!$rootScope.$$phase) {
                    $rootScope.$digest();
                }
            });
        },

        cancelLogin: function () {
            this.auth.cancelLogin();
        },

        refreshLogin: function () {
            if (!this.loggedIn()) {
                throw 'Cannot refresh, not logged in.';
            }
            
            var me = this;
            this.auth.refreshLogin(this.state, function(result) {
                if (result.status === 'accepted') {
                    var origUser = me.state.user;
                    me.state = result.newState;
                    // FIXME This is silly
                    if (!('user' in me.state)) {
                        me.state.user = origUser;
                    }
                    me._onStateChange();
                } else {
                    // FIXME Do something about this, maybe retry soonish
                }
            });
        },

        logout: function () {
            if (this.loggedIn()) {
                if (this.settings.logoutUrl !== null) {
                    // FIXME Can't depend on $http directly, causes a false
                    // alarm for circular dependency :-(
                    var http = $injector.get('$http');
                    var httpConf = {
                        method: 'POST',
                        data: '',
                        url: this.settings.logoutUrl
                    };
                    this.updateRequestConf(httpConf);
                    http(httpConf);
                }
                this.reset();
                $location.path(this.settings.loginPath);
            }
        },

        reset: function () {
            this.state = null;
            this._onStateChange();
        },

        cookieKey: function () {
            return this.settings.sessionName + '-' + this.auth.getAuthType();
        },

        updateRequestConf: function(httpConf) {
            httpConf.sessionDictKey = this.cookieKey();
            if (this.loggedIn()) {
                if (!httpConf.headers) { httpConf.headers = {}; }
                this.auth.addAuthToRequestConf(httpConf, this.state);
            }
        },

        manageRequestConf: function(httpConf) {
            this.managedHttpConfs.push({
                conf: httpConf,
                original: angular.copy(httpConf)
            });
            this.updateRequestConf(httpConf);
        },

        reupdateManagedRequestConfs: function() {
            var me = this;
            angular.forEach(this.managedHttpConfs, function(o) {
                for (var key in o.conf) { delete o.conf[key]; }
                var originalConf = angular.copy(o.original);
                angular.extend(o.conf, originalConf);
                me.updateRequestConf(o.conf);
            });
        },

        handleHttpResponse: function(response) {
            var authResult = this.auth.checkResponse(response);
            if (authResult.authFailure) {
                this.reset();
                this.priorPath = $location.path();
                $location.path(this.settings.loginPath).replace();
                return $q.reject(response);
            } else {
                return response;
            }
        },

        _onStateChange: function() {
            this.reupdateManagedRequestConfs();

            if (this.state !== null) {
                $cookieStore.put(this.cookieKey(), this.state);
                if (this.refreshPromise !== null) {
                    $timeout.cancel(this.refreshPromise);
                }
                if ('millisecondsToRefresh' in this.state) {
                    var me = this;
                    this.refreshPromise = $timeout(
                        function() { me.refreshLogin(); },
                        this.state.millisecondsToRefresh
                    );
                }
            } else {
                if (this.refreshPromise !== null) {
                    $timeout.cancel(this.refreshPromise);
                    this.refreshPromise = null;
                }
                $cookieStore.remove(this.cookieKey());
            }
        }
    };

    var AuthSessionFactory = function(auth, settings) {
        return new AuthSession(auth, settings);
    };
    AuthSessionFactory.dictionary = sessionDictionary;
    return AuthSessionFactory;
}]);

'use strict';

// No-refresh OpenID approach based on Brian Ellin's:
// http://openid-demo.appspot.com/
// Which was based in turn on a post by Luke Shepard:
// http://www.sociallipstick.com/?p=86

angular.module('secureNgResource')
.factory('openIDAuth', [
function() {
    var OpenIDAuth = function (host, beginPath) {
        this.host = host;
        this.beginPath = beginPath;
    };

    OpenIDAuth.prototype = {
        getAuthType: function () {
            return 'OpenIDAuth';
        },

        checkLogin: function (credentials, handler) {
            window.handleAuthResponse = function(d) {
                delete window.handleAuthResponse;
                delete window.openIdPopup;

                if (d.approved) {
                    handler({
                        status: 'accepted',
                        newState: {
                            sessionId: d.sessionId
                        }
                    });
                } else {
                    handler({
                        status: 'denied',
                        msg: d.message || 'Access denied'
                    });
                }
            };

            if (window.hasOwnProperty('openIdPopup')) {
                if ('focus' in window.openIdPopup) {
                    window.openIdPopup.focus();
                }
                return;
            }

            var opts = 'width=450,height=500,location=1,status=1,resizable=yes';
            var popup = window.open('', 'openid_popup', opts);
            popup.document.write(
                '<form id="shimform"' +
                ' method="post"' +
                ' action="' + this.host + this.beginPath + '">' +
                '<input type="hidden" name="openid_identifier" id="oid" />' +
                '</form>'
            );
            var oid = credentials['openid_identifier'];
            popup.document.getElementById('oid').value = oid;
            popup.document.getElementById('shimform').submit();
            window.openIdPopup = popup;
        },

        cancelLogin: function() {
            if (window.hasOwnProperty('openIdPopup')) {
                window.openIdPopup.close();

                delete window.openIdPopup;
                delete window.handleAuthResponse;
            }
        },

        refreshLogin: function(/*handler*/) {
            // Do nothing
            // TODO Do a no-op request just to keep session fresh?
        },

        checkResponse: function (response) {
            var authResult = {};
            if (response.status === 401 || response.status === 403) {
                authResult.authFailure = true;
            }
            return authResult;
        },

        addAuthToRequestConf: function (httpConf, state) {
            httpConf.headers.Authorization = 'SesID ' + state.sessionId;
        }
    };

    var OpenIDAuthFactory = function(host, beginPath) {
        return new OpenIDAuth(host, beginPath);
    };
    return OpenIDAuthFactory;
}]);

'use strict';

angular.module('secureNgResource')
.factory('passwordOAuth', [
'$http',
function($http) {
    var PasswordOAuth = function (host, clientId, clientSecret) {
        this.host = host;
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
    
    var handleTokenResponse = function (handler, response) {
        if (
        response.status === 200 &&
        angular.isString(response.data['access_token'])
        ) {
            var d = response.data;
            handler({
                status: 'accepted',
                newState: {
                    accessToken: d['access_token'],
                    accessTokenExpires:
                        new Date().getTime() + d['expires_in'],
                    millisecondsToRefresh:
                        d['expires_in']*1000/2, // Refresh at halfway point
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
    };

    PasswordOAuth.prototype = {
        getAuthType: function () {
            return 'PasswordOAuth';
        },

        checkLogin: function (credentials, handler) {
            $http({
                method: 'POST',
                url: this.host + '/oauth/v2/token',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                data: encodeURIForm({
                    'client_id': this.clientId,
                    'client_secret': this.clientSecret,
                    'grant_type': 'password',
                    'username': credentials.user,
                    'password': credentials.pass
                })
            }).then(function (response) {
                handleTokenResponse(handler, response);
            });
        },

        cancelLogin: function () {}, // TODO Cancel any current HTTP request

        refreshLogin: function(state, handler) {
            $http({
                method: 'POST',
                url: this.host + '/oauth/v2/token',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                data: encodeURIForm({
                    'client_id': this.clientId,
                    'client_secret': this.clientSecret,
                    'grant_type': 'refresh_token',
                    'refresh_token': state.refreshToken
                })
            }).then(function (response) {
                if ('data' in response && !('refresh_token' in response.data)) {
                    response.data['refresh_token'] = state.refreshToken;
                }
                handleTokenResponse(handler, response);
            });
        },

        checkResponse: function (response) {
            // TODO: If our access_token is getting stale, then get a new one,
            // and have the session update the request configs
            var authResult = {};
            if (response.status === 401) {
                authResult.authFailure = true;
            }
            return authResult;
        },

        addAuthToRequestConf: function (httpConf, state) {
            httpConf.headers.Authorization = 'Bearer ' + state.accessToken;
        }
    };

    var PasswordOAuthFactory = function(host, clientId, clientSecret) {
        return new PasswordOAuth(host, clientId, clientSecret);
    };
    return PasswordOAuthFactory;
}]);

'use strict';

angular.module('secureNgResource')
.factory('secureResource', [
'$resource',
function($resource) {
    var DEFAULT_ACTIONS = {
        'get':    {method:'GET'},
        'save':   {method:'POST'},
        'query':  {method:'GET', isArray:true},
        'remove': {method:'DELETE'},
        'delete': {method:'DELETE'}
    };

    return function(session, url, paramDefaults, actions) {
        var fullActions = angular.extend({}, DEFAULT_ACTIONS, actions);
        angular.forEach(fullActions, function(httpConf) {
            session.manageRequestConf(httpConf);
        });

        // Escape the colon before a port number, it confuses ngResource
        url = url.replace(/^([^\/].+?)(:\d+\/)/g, '$1\\$2');
        var res = $resource(url, paramDefaults, fullActions);

        return res;
    };
}]);

'use strict';

angular.module('secureNgResource')
.config([
'$httpProvider',
function($httpProvider) {
    // TODO Interceptors are deprecated, but we need access to the
    // status code of the response and transformResponse cannot get us that.
    $httpProvider.responseInterceptors.push([
    'authSession',
    function(authSession) {
        var responder = function (response) {
            // Failure
            var ses = authSession.dictionary[response.config.sessionDictKey];
            if (ses) {
                return ses.handleHttpResponse(response);
            } else {
                // Let someone else deal with this problem
                return response;
            }
        };

        return function(promise) {
            return promise.then(responder, responder);
        };
    }]);
}]);

}(window));