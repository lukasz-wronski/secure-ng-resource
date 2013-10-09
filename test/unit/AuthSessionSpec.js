'use strict';

describe('AuthSession', function () {
    beforeEach(module('secureNgResource'));

    var $scope, $httpBackend, sessionFactory, ses, auth, loc, timeout, q;
    beforeEach(inject(function ($rootScope, $injector, authSession, $location, $timeout, $q) {
        $scope = $rootScope.$new();
        $httpBackend = $injector.get('$httpBackend');

        auth = {
            getAuthType: function() { return "mockAuth"; },
            checkLoginResult: {
                status: 'accepted',
                newState: { user: 'someone' }
            },
            checkLogin: function(creds) {
                var deferred = q.defer();
                if (this.checkLoginResult.status === 'accepted') {
                    deferred.resolve(this.checkLoginResult);
                } else {
                    deferred.reject(this.checkLoginResult);
                }
                return deferred.promise;
            },
            addAuthToRequestConf: function(httpConf, state) {
                httpConf.headers.Authorization = "foo";
            },
            checkResponseResult: {},
            checkResponse: function(response) {
                return this.checkResponseResult;
            },
            refreshLogin: function(state) {
                var deferred = q.defer();
                var p = deferred.promise;
                deferred.resolve({
                    status: 'accepted',
                    newState: state
                });
                return p;
            }
        };
        spyOn(auth, 'checkLogin').andCallThrough();
        spyOn(auth, 'addAuthToRequestConf').andCallThrough();
        spyOn(auth, 'checkResponse').andCallThrough();

        sessionFactory = authSession;
        ses = sessionFactory(auth);
        loc = $location;
        spyOn(loc, 'path').andCallFake(function(a) {
            if (a) {
                return loc; // Path set
            } else {
                return '/some/resource'; // Path get
            }
        });
        spyOn(loc, 'replace').andReturn(loc);

        timeout = $timeout;
        q = $q;
    }));

    afterEach(function() {
        $httpBackend.verifyNoOutstandingExpectation();
        $httpBackend.verifyNoOutstandingRequest();
    });

    it('has the correct initial state by default', function() {
        expect(ses.getUserName()).toBeUndefined();
        expect(ses.loggedIn()).toEqual(false);
        expect(ses.cookieKey()).toEqual('angular-mockAuth');
    });

    it('can use a custom cookie key', function () {
        var ses2 = sessionFactory(auth, {sessionName: 'foo'});
        expect(ses2.cookieKey()).toEqual('foo-mockAuth');
    });

    it('accepts logins which the authenticator approves', function() {
        auth.checkLoginResult.newState.user = 'alice';
        ses.login({user: 'alice', pass: 'swordfish'});
        $scope.$apply();
        expect(ses.getUserName()).toEqual('alice');
        expect(ses.loggedIn()).toEqual(true);
    });

    it('denies logins which the authenticator does not approve', function() {
        auth.checkLoginResult =  { status: 'denied', msg: 'And stay out' };
        ses.login({user: 'alice', pass: 'swordfish'});
        $scope.$apply();
        expect(ses.getUserName()).toBeUndefined();
        expect(ses.loggedIn()).toEqual(false);
    });

    it('creates a refresh timeout if requested by login result', function() {
        auth.checkLoginResult.newState.millisecondsToRefresh = 10000;
        ses.login({user: 'alice', pass: 'swordfish'});
        spyOn(auth, 'refreshLogin').andCallThrough();
        $scope.$apply();

        expect(auth.refreshLogin).not.toHaveBeenCalled();
        timeout.flush();
        expect(auth.refreshLogin).toHaveBeenCalled();
    });

    it('cancels the refresh timeout if manually logged out', function() {
        auth.checkLoginResult.newState.millisecondsToRefresh = 10000;
        spyOn(auth, 'refreshLogin');
        ses.login({user: 'alice', pass: 'swordfish'});
        $scope.$apply();
        expect(auth.refreshLogin).not.toHaveBeenCalled();
        ses.logout();

        timeout(function() {}, 10000); // Fake event so flush doesn't complain
        timeout.flush();

        expect(auth.refreshLogin).not.toHaveBeenCalled();
    });

    it('cancels any refresh timeout on new login without refresh', function() {
        auth.checkLoginResult.newState.millisecondsToRefresh = 10000;
        spyOn(auth, 'refreshLogin');
        ses.login({user: 'alice', pass: 'swordfish'});
        $scope.$apply();
        delete auth.checkLoginResult.newState.millisecondsToRefresh;
        ses.login({user: 'alice', pass: 'swordfish'});
        $scope.$apply();

        timeout(function() {}, 10000); // Fake event so flush doesn't complain
        timeout.flush();

        expect(auth.refreshLogin).not.toHaveBeenCalled();
    });

    it('replaces any refresh timeout on new login with refresh', function() {
        auth.checkLoginResult.newState.millisecondsToRefresh = 10000;
        spyOn(auth, 'refreshLogin').andCallThrough();
        ses.login({user: 'alice', pass: 'swordfish'});
        $scope.$apply();
        auth.checkLoginResult.newState.user = 'someone_else';
        ses.login({user: 'alice', pass: 'swordfish'});
        $scope.$apply();

        timeout(function() {}, 10000); // Fake event so flush doesn't complain
        timeout.flush();

        expect(auth.refreshLogin).toHaveBeenCalledWith({
            millisecondsToRefresh: 10000,
            user: 'someone_else'
        });
        expect(auth.refreshLogin.callCount).toEqual(1);
    });

    it('can drop the session state', function() {
        ses.login({user: 'alice', pass: 'swordfish'});
        ses.reset();
        expect(ses.getUserName()).toBeUndefined();
        expect(ses.loggedIn()).toEqual(false);
    });

    it('drops session state after logout', function() {
        ses.login({user: 'alice', pass: 'swordfish'});
        ses.logout();
        expect(ses.getUserName()).toBeUndefined();
        expect(ses.loggedIn()).toEqual(false);
    });

    it('sends a synchronous request to a logout path if there is one', function() {
        var ses2 = sessionFactory(auth, {logoutUrl: 'http://example.com:9001/logmeout'});
        ses2.login({user: 'alice', pass: 'swordfish'});
        $scope.$apply();
        $httpBackend.expectPOST(
            'http://example.com:9001/logmeout', '', {
                'Authorization': 'foo',
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json;charset=utf-8',
            }
        ).respond({loggedOut: true});
        ses2.logout();
        $scope.$apply();
        $httpBackend.flush();
    });

    it('resets location to / after a successful login by default', function () {
        ses.login({user: 'alice', pass: 'swordfish'});
        $scope.$apply();
        expect(loc.path).toHaveBeenCalledWith('/');
        expect(loc.replace).toHaveBeenCalled();
    });

    it('can reset after login to a custom path', function () {
        var ses2 = sessionFactory(auth, {defaultPostLoginPath: '/foo'});
        ses2.login({user: 'alice', pass: 'swordfish'});
        $scope.$apply();
        expect(loc.path).toHaveBeenCalledWith('/foo');
        expect(loc.replace).toHaveBeenCalled();
    });

    it('clears session, resets to login page after http auth failure', function () {
        auth.checkResponseResult = { authFailure: true };
        spyOn(ses, 'reset');
        ses.handleHttpResponse({});
        expect(auth.checkResponse).toHaveBeenCalled();
        expect(ses.reset).toHaveBeenCalled();
        expect(loc.path).toHaveBeenCalledWith('/login');
        expect(loc.replace).toHaveBeenCalled();
    });

    it('does not clear session or reset to login page on non-auth fail', function () {
        spyOn(ses, 'reset');
        ses.handleHttpResponse({});
        expect(auth.checkResponse).toHaveBeenCalled();
        expect(ses.reset).not.toHaveBeenCalled();
        expect(loc.path).not.toHaveBeenCalled();
        expect(loc.replace).not.toHaveBeenCalled();
    });

    it('resets back to original pre-reset path after login', function() {
        auth.checkResponseResult = { authFailure: true };
        ses.handleHttpResponse();
        ses.login({user: 'alice', pass: 'swordfish'});
        $scope.$apply();
        expect(loc.path).toHaveBeenCalledWith('/some/resource');
        expect(loc.replace).toHaveBeenCalled();
    });

    it('redirects to /login after logout by default', function () {
        ses.login({user: 'alice', pass: 'swordfish'});
        $scope.$apply();
        expect(loc.replace.calls.length).toEqual(1);
        ses.logout();
        $scope.$apply();
        expect(loc.path).toHaveBeenCalledWith('/login');
        expect(loc.replace.calls.length).toEqual(1);
    });

    it('can redirect to a custom login page', function () {
        var ses2 = sessionFactory(auth, {loginPath: '/welcome'});
        ses2.login({user: 'alice', pass: 'swordfish'});
        $scope.$apply();
        expect(loc.replace.calls.length).toEqual(1);
        ses2.logout();
        $scope.$apply();
        expect(loc.path).toHaveBeenCalledWith('/welcome');
        expect(loc.replace.calls.length).toEqual(1);
    });

    it('allows auth to update outgoing requests when logged in', function () {
        var httpConf = {headers: {}};
        ses.manageRequestConf(httpConf);

        expect(httpConf.headers.Authorization).toBeUndefined();
        ses.login({user: 'alice', pass: 'swordfish'});
        $scope.$apply();
        expect(httpConf.headers.Authorization).toBeDefined();
        ses.reset();
        $scope.$apply();
        expect(httpConf.headers.Authorization).toBeUndefined();
    });

    it('always attaches key to request configs', function () {
        var httpConf = {};
        ses.manageRequestConf(httpConf);
        expect(httpConf.sessionDictKey).toEqual(ses.cookieKey());
        ses.login({user: 'alice', pass: 'swordfish'});
        $scope.$apply();
        expect(httpConf.sessionDictKey).toEqual(ses.cookieKey());
        ses.reset();
        $scope.$apply();
        expect(httpConf.sessionDictKey).toEqual(ses.cookieKey());
    });
});
