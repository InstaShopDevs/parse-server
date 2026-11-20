const LoggerController = require('../lib/Controllers/LoggerController').LoggerController;
const WinstonLoggerAdapter = require('../lib/Adapters/Logger/WinstonLoggerAdapter')
  .WinstonLoggerAdapter;
const fs = require('fs');
const Config = require('../lib/Config');

const loremFile = __dirname + '/support/lorem.txt';

describe('Cloud Code Logger', () => {
  let user;
  let spy;
  beforeEach(async () => {
    Parse.User.enableUnsafeCurrentUser();
    return reconfigureServer({
      // useful to flip to false for fine tuning :).
      silent: true,
      logLevel: undefined,
      logLevels: {
        cloudFunctionError: 'error',
        cloudFunctionSuccess: 'info',
        triggerAfter: 'info',
        triggerBeforeError: 'error',
        triggerBeforeSuccess: 'info',
      },
    })
      .then(() => {
        return Parse.User.signUp('tester', 'abc')
          .catch(() => {})
          .then(loggedInUser => (user = loggedInUser))
          .then(() => Parse.User.logIn(user.get('username'), 'abc'));
      })
      .then(() => {
        spy = spyOn(Config.get('test').loggerController.adapter, 'log').and.callThrough();
      });
  });

  // Note that helpers takes care of logout.
  // see helpers.js:afterEach

  it_id('02d53b97-3ec7-46fb-abb6-176fd6e85590')(it)('should expose log to functions', () => {
    const spy = spyOn(Config.get('test').loggerController, 'log').and.callThrough();
    Parse.Cloud.define('loggerTest', req => {
      req.log.info('logTest', 'info log', { info: 'some log' });
      req.log.error('logTest', 'error log', { error: 'there was an error' });
      return {};
    });

    return Parse.Cloud.run('loggerTest').then(() => {
      expect(spy).toHaveBeenCalledTimes(3);
      const cloudFunctionMessage = spy.calls.all()[2];
      const errorMessage = spy.calls.all()[1];
      const infoMessage = spy.calls.all()[0];
      expect(cloudFunctionMessage.args[0]).toBe('info');
      expect(cloudFunctionMessage.args[1][1].params).toEqual({});
      expect(cloudFunctionMessage.args[1][0]).toMatch(
        /Ran cloud function loggerTest for user [^ ]* with:\n {2}Input: {}\n {2}Result: {}/
      );
      expect(cloudFunctionMessage.args[1][1].functionName).toEqual('loggerTest');
      expect(errorMessage.args[0]).toBe('error');
      expect(errorMessage.args[1][2].error).toBe('there was an error');
      expect(errorMessage.args[1][0]).toBe('logTest');
      expect(errorMessage.args[1][1]).toBe('error log');
      expect(infoMessage.args[0]).toBe('info');
      expect(infoMessage.args[1][2].info).toBe('some log');
      expect(infoMessage.args[1][0]).toBe('logTest');
      expect(infoMessage.args[1][1]).toBe('info log');
    });
  });

  it_id('768412f5-d32f-4134-89a6-08949781a6c0')(it)('trigger should obfuscate password', done => {
    Parse.Cloud.beforeSave(Parse.User, req => {
      return req.object;
    });

    Parse.User.signUp('tester123', 'abc')
      .then(() => {
        const entry = spy.calls.mostRecent().args;
        expect(entry[1]).not.toMatch(/password":"abc/);
        expect(entry[1]).toMatch(/\*\*\*\*\*\*\*\*/);
        done();
      })
      .then(null, e => done.fail(e));
  });

  it_id('3c394047-272e-4728-9d02-9eaa660d2ed2')(it)('should expose log to trigger', done => {
    Parse.Cloud.beforeSave('MyObject', req => {
      req.log.info('beforeSave MyObject', 'info log', { info: 'some log' });
      req.log.error('beforeSave MyObject', 'error log', {
        error: 'there was an error',
      });
      return {};
    });

    const obj = new Parse.Object('MyObject');
    obj.save().then(() => {
      const lastCalls = spy.calls.all().reverse();
      const cloudTriggerMessage = lastCalls[0].args;
      const errorMessage = lastCalls[1].args;
      const infoMessage = lastCalls[2].args;
      expect(cloudTriggerMessage[0]).toBe('info');
      expect(cloudTriggerMessage[2].triggerType).toEqual('beforeSave');
      expect(cloudTriggerMessage[1]).toMatch(
        /beforeSave triggered for MyObject for user [^ ]*\n {2}Input: {}\n {2}Result: {"object":{}}/
      );
      expect(cloudTriggerMessage[2].user).toBe(user.id);
      expect(errorMessage[0]).toBe('error');
      expect(errorMessage[3].error).toBe('there was an error');
      expect(errorMessage[1] + ' ' + errorMessage[2]).toBe('beforeSave MyObject error log');
      expect(infoMessage[0]).toBe('info');
      expect(infoMessage[3].info).toBe('some log');
      expect(infoMessage[1] + ' ' + infoMessage[2]).toBe('beforeSave MyObject info log');
      done();
    });
  });

  it('should truncate really long lines when asked to', () => {
    const logController = new LoggerController(new WinstonLoggerAdapter());
    const longString = fs.readFileSync(loremFile, 'utf8');
    const truncatedString = logController.truncateLogMessage(longString);
    expect(truncatedString.length).toBe(1015); // truncate length + the string '... (truncated)'
  });

  it_id('4a009b1f-9203-49ca-8d48-5b45f4eedbdf')(it)('should truncate input and result of long lines', done => {
    const longString = fs.readFileSync(loremFile, 'utf8');
    Parse.Cloud.define('aFunction', req => {
      return req.params;
    });

    Parse.Cloud.run('aFunction', { longString })
      .then(() => {
        const log = spy.calls.mostRecent().args;
        expect(log[0]).toEqual('info');
        expect(log[1]).toMatch(
          /Ran cloud function aFunction for user [^ ]* with:\n {2}Input: {.*?\(truncated\)$/m
        );
        done();
      })
      .then(null, e => done.fail(e));
  });

  it_id('9857e15d-bb18-478d-8a67-fdaad3e89565')(it)('should log an afterSave', done => {
    Parse.Cloud.afterSave('MyObject', () => {});
    new Parse.Object('MyObject')
      .save()
      .then(() => {
        const log = spy.calls.mostRecent().args;
        expect(log[2].triggerType).toEqual('afterSave');
        done();
      })
      // catch errors - not that the error is actually useful :(
      .then(null, e => done.fail(e));
  });

  it_id('ec13a296-f8b1-4fc6-985a-3593462edd9c')(it)('should log a denied beforeSave', done => {
    Parse.Cloud.beforeSave('MyObject', () => {
      throw 'uh oh!';
    });

    new Parse.Object('MyObject')
      .save()
      .then(
        () => done.fail('this is not supposed to succeed'),
        () => new Promise(resolve => setTimeout(resolve, 100))
      )
      .then(() => {
        const logs = spy.calls.all().reverse();
        const log = logs[1].args; // 0 is the 'uh oh!' from rejection...
        expect(log[0]).toEqual('error');
        const error = log[2].error;
        expect(error instanceof Parse.Error).toBeTruthy();
        expect(error.code).toBe(Parse.Error.SCRIPT_FAILED);
        expect(error.message).toBe('uh oh!');
        done();
      });
  });

  it_id('3e0caa45-60d6-41af-829a-fd389710c132')(it)('should log cloud function success', done => {
    Parse.Cloud.define('aFunction', () => {
      return 'it worked!';
    });

    Parse.Cloud.run('aFunction', { foo: 'bar' }).then(() => {
      const log = spy.calls.mostRecent().args;
      expect(log[0]).toEqual('info');
      expect(log[1]).toMatch(
        /Ran cloud function aFunction for user [^ ]* with:\n {2}Input: {"foo":"bar"}\n {2}Result: "it worked!/
      );
      done();
    });
  });

  it_id('8088de8a-7cba-4035-8b05-4a903307e674')(it)('should log cloud function execution using the custom log level', async done => {
    Parse.Cloud.define('aFunction', () => {
      return 'it worked!';
    });

    Parse.Cloud.define('bFunction', () => {
      throw new Error('Failed');
    });

    await Parse.Cloud.run('aFunction', { foo: 'bar' }).then(() => {
      const log = spy.calls.allArgs().find(log => log[1].startsWith('Ran cloud function '))?.[0];
      expect(log).toEqual('info');
    });

    await reconfigureServer({
      silent: true,
      logLevels: {
        cloudFunctionSuccess: 'warn',
        cloudFunctionError: 'info',
      },
    });

    spy = spyOn(Config.get('test').loggerController.adapter, 'log').and.callThrough();

    try {
      await Parse.Cloud.run('bFunction', { foo: 'bar' });
      throw new Error('bFunction should have failed');
    } catch {
      const log = spy.calls
        .allArgs()
        .find(log => log[1].startsWith('Failed running cloud function bFunction for '))?.[0];
      expect(log).toEqual('info');
      done();
    }
  });

  it('should log cloud function triggers using the custom log level', async () => {
    Parse.Cloud.beforeSave('TestClass', () => {});
    Parse.Cloud.afterSave('TestClass', () => {});

    const execTest = async (logLevel, triggerBeforeSuccess, triggerAfter) => {
      await reconfigureServer({
        silent: true,
        logLevel,
        logLevels: {
          triggerAfter,
          triggerBeforeSuccess,
        },
      });

      spy = spyOn(Config.get('test').loggerController.adapter, 'log').and.callThrough();
      const obj = new Parse.Object('TestClass');
      await obj.save();

      return {
        beforeSave: spy.calls
          .allArgs()
          .find(log => log[1].startsWith('beforeSave triggered for TestClass for user '))?.[0],
        afterSave: spy.calls
          .allArgs()
          .find(log => log[1].startsWith('afterSave triggered for TestClass for user '))?.[0],
      };
    };

    let calls = await execTest('silly', 'silly', 'debug');
    expect(calls).toEqual({ beforeSave: 'silly', afterSave: 'debug' });

    calls = await execTest('info', 'warn', 'debug');
    expect(calls).toEqual({ beforeSave: 'warn', afterSave: undefined });
  });

  it_id('97e0eafa-cde6-4a9a-9e53-7db98bacbc62')(it)('should log cloud function failure', done => {
    Parse.Cloud.define('aFunction', () => {
      throw 'it failed!';
    });

    Parse.Cloud.run('aFunction', { foo: 'bar' })
      .catch(() => {})
      .then(() => {
        const logs = spy.calls.all().reverse();
        expect(logs[0].args[1]).toBe('Parse error: ');
        expect(logs[0].args[2].message).toBe('it failed!');

        const log = logs[1].args;
        expect(log[0]).toEqual('error');
        expect(log[1]).toMatch(
          /Failed running cloud function aFunction for user [^ ]* with:\n {2}Input: {"foo":"bar"}\n {2}Error:/
        );
        const errorString = JSON.stringify(
          new Parse.Error(Parse.Error.SCRIPT_FAILED, 'it failed!')
        );
        expect(log[1].indexOf(errorString)).toBeGreaterThan(0);
        done();
      })
      .catch(done.fail);
  });

  xit('should log a changed beforeSave indicating a change', done => {
    pending('needs more work.....');
    const logController = new LoggerController(new WinstonLoggerAdapter());

    Parse.Cloud.beforeSave('MyObject', req => {
      const myObj = req.object;
      myObj.set('aChange', true);
      return myObj;
    });

    new Parse.Object('MyObject')
      .save()
      .then(() => logController.getLogs({ from: Date.now() - 500, size: 1000 }))
      .then(() => {
        // expect the log to indicate that it has changed
        /*
                    Here's what it looks like on parse.com...

                    Input: {"original":{"clientVersion":"1","createdAt":"2016-06-02T05:29:08.694Z","image":{"__type":"File","name":"tfss-xxxxxxxx.png","url":"http://files.parsetfss.com/xxxxxxxx.png"},"lastScanDate":{"__type":"Date","iso":"2016-06-02T05:28:58.135Z"},"localIdentifier":"XXXXX","objectId":"OFHMX7ZUcI","status":... (truncated)
                    Result: Update changed to {"object":{"__type":"Pointer","className":"Emoticode","objectId":"ksrq7z3Ehc"},"imageThumb":{"__type":"File","name":"tfss-xxxxxxx.png","url":"http://files.parsetfss.com/xxxxx.png"},"status":"success"}
                */
        done();
      })
      .then(null, e => done.fail(JSON.stringify(e)));
  });

  it_id('b86e8168-8370-4730-a4ba-24ca3016ad66')(it)('cloud function should obfuscate password', done => {
    Parse.Cloud.define('testFunction', () => {
      return 'verify code success';
    });

    Parse.Cloud.run('testFunction', { username: 'hawk', password: '123456' })
      .then(() => {
        const entry = spy.calls.mostRecent().args;
        expect(entry[2].params.password).toMatch(/\*\*\*\*\*\*\*\*/);
        done();
      })
      .then(null, e => done.fail(e));
  });

  it('should only log once for object not found', async () => {
    const config = Config.get('test');
    const spy = spyOn(config.loggerController, 'error').and.callThrough();
    try {
      const object = new Parse.Object('Object');
      object.id = 'invalid';
      await object.fetch();
    } catch (e) {
      /**/
    }
    expect(spy).toHaveBeenCalled();
    expect(spy.calls.count()).toBe(1);
    const { args } = spy.calls.mostRecent();
    expect(args[0]).toBe('Parse error: ');
    expect(args[1].message).toBe('Object not found.');
  });

  it('should log cloud function execution using the silent log level', async () => {
    await reconfigureServer({
      logLevels: {
        cloudFunctionSuccess: 'silent',
        cloudFunctionError: 'silent',
      },
    });
    Parse.Cloud.define('aFunction', () => {
      return 'it worked!';
    });
    Parse.Cloud.define('bFunction', () => {
      throw new Error('Failed');
    });
    spy = spyOn(Config.get('test').loggerController.adapter, 'log').and.callThrough();

    await Parse.Cloud.run('aFunction', { foo: 'bar' });
    expect(spy).toHaveBeenCalledTimes(0);

    await expectAsync(Parse.Cloud.run('bFunction', { foo: 'bar' })).toBeRejected();
    // Not "Failed running cloud function message..."
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should log cloud function triggers using the silent log level', async () => {
    await reconfigureServer({
      logLevels: {
        triggerAfter: 'silent',
        triggerBeforeSuccess: 'silent',
        triggerBeforeError: 'silent',
      },
    });
    Parse.Cloud.beforeSave('TestClassError', () => {
      throw new Error('Failed');
    });
    Parse.Cloud.beforeSave('TestClass', () => {});
    Parse.Cloud.afterSave('TestClass', () => {});

    spy = spyOn(Config.get('test').loggerController.adapter, 'log').and.callThrough();

    const obj = new Parse.Object('TestClass');
    await obj.save();
    expect(spy).toHaveBeenCalledTimes(0);

    const objError = new Parse.Object('TestClassError');
    await expectAsync(objError.save()).toBeRejected();
    // Not "beforeSave failed for TestClassError for user ..."
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('Cloud Code Logger per-function options', () => {
  let spy;
  const logsFor = prefix =>
    spy.calls.allArgs().filter(args => typeof args[1] === 'string' && args[1].startsWith(prefix));

  beforeEach(async () => {
    await reconfigureServer({
      silent: true,
      logLevel: undefined,
      logLevels: {
        cloudFunctionError: 'error',
        cloudFunctionSuccess: 'info',
        triggerAfter: 'info',
        triggerBeforeError: 'error',
        triggerBeforeSuccess: 'info',
      },
    });
    spy = spyOn(Config.get('test').loggerController.adapter, 'log').and.callThrough();
  });

  it('silences the success log of only the function defined with logLevel silent', async () => {
    Parse.Cloud.define('quietFunction', () => 'ok', { logLevel: 'silent' });
    Parse.Cloud.define('loudFunction', () => 'ok');

    await Parse.Cloud.run('quietFunction', { foo: 'bar' });
    await Parse.Cloud.run('loudFunction', { foo: 'bar' });

    expect(logsFor('Ran cloud function quietFunction ').length).toBe(0);
    const loud = logsFor('Ran cloud function loudFunction ');
    expect(loud.length).toBe(1);
    expect(loud[0][0]).toBe('info');
  });

  it('uses the per-function logLevel instead of logLevels.cloudFunctionSuccess', async () => {
    Parse.Cloud.define('warnFunction', () => 'ok', { logLevel: 'warn' });

    await Parse.Cloud.run('warnFunction');

    const logs = logsFor('Ran cloud function warnFunction ');
    expect(logs.length).toBe(1);
    expect(logs[0][0]).toBe('warn');
  });

  it('keeps logging errors of a function whose success logLevel is silent', async () => {
    Parse.Cloud.define(
      'quietFailingFunction',
      () => {
        throw new Error('Failed');
      },
      { logLevel: 'silent' }
    );

    await expectAsync(Parse.Cloud.run('quietFailingFunction')).toBeRejected();

    const logs = logsFor('Failed running cloud function quietFailingFunction ');
    expect(logs.length).toBe(1);
    expect(logs[0][0]).toBe('error');
  });

  it('keeps other validator options enforced alongside logLevel', async () => {
    Parse.Cloud.define('guardedQuietFunction', () => 'ok', {
      logLevel: 'silent',
      requireUser: true,
    });

    try {
      await Parse.Cloud.run('guardedQuietFunction');
      fail('Expected guardedQuietFunction to require a user.');
    } catch (e) {
      expect(e.code).toBe(Parse.Error.VALIDATION_ERROR);
      expect(e.message).toBe('Validation failed. Please login to continue.');
    }
  });

  it('rejects an unknown logLevel value', () => {
    try {
      Parse.Cloud.define('badLevelFunction', () => 'ok', { logLevel: 'nope' });
      fail('Expected an invalid logLevel to be rejected.');
    } catch (e) {
      expect(e).toBe(
        `Invalid logLevel 'nope' for Cloud Function validation. Expected one of ${JSON.stringify([
          'error',
          'warn',
          'info',
          'debug',
          'verbose',
          'silly',
          'silent',
        ])}`
      );
    }
  });

  it('rejects a logLevel that is not a string', () => {
    try {
      Parse.Cloud.define('numberLevelFunction', () => 'ok', { logLevel: 1 });
      fail('Expected a non-string logLevel to be rejected.');
    } catch (e) {
      expect(e).toBe(
        'Invalid type for Cloud Function validation key logLevel. Expected string, actual number'
      );
    }
  });

  it('rejects logLevel on triggers, where it would have no effect', () => {
    try {
      Parse.Cloud.beforeSave('TestObject', () => {}, { logLevel: 'silent' });
      fail('Expected logLevel to be rejected on a trigger.');
    } catch (e) {
      expect(e).toBe('logLevel is not a supported parameter for Cloud Function validations.');
    }
  });

  it('omits input from success and failure entries while passing all params to the handler', async () => {
    Parse.Cloud.define(
      'omitInput',
      ({ params }) => {
        if (params.fail) {
          throw new Error('lookup failed');
        }
        return params.clientIds.length;
      },
      { logParams: false, logResult: true }
    );

    const params = { clientIds: ['excluded-client'] };
    expect(await Parse.Cloud.run('omitInput', params)).toBe(1);
    await expectAsync(Parse.Cloud.run('omitInput', { ...params, fail: true })).toBeRejected();

    const [success] = logsFor('Ran cloud function omitInput ');
    const [failure] = logsFor('Failed running cloud function omitInput ');
    for (const entry of [success, failure]) {
      expect(entry[1]).not.toContain('Input:');
      expect(Object.hasOwn(entry[2], 'params')).toBeFalse();
      expect(Object.hasOwn(entry[2], 'cleanParams')).toBeFalse();
      expect(JSON.stringify(entry)).not.toContain('excluded-client');
    }
    expect(success[2].output).toBe(1);
    expect(failure[2].error.message).toBe('lookup failed');
  });

  it('logs only selected top-level params on success and validation failure', async () => {
    Parse.Cloud.define('selectedInput', ({ params }) => params.clientIds.length, {
      logLevel: 'warn',
      logParams: ['limit', 'filter', 'missing', 'credentials.secret', 'toString', 'password'],
      fields: ['requiredField'],
    });
    const params = {
      clientIds: ['excluded-client'],
      credentials: { secret: 'excluded-secret' },
      password: 'excluded-password',
      limit: 0,
      filter: { active: false },
    };
    const selected = { limit: 0, filter: { active: false }, password: '********' };

    expect(await Parse.Cloud.run('selectedInput', { ...params, requiredField: true })).toBe(1);
    await expectAsync(Parse.Cloud.run('selectedInput', params)).toBeRejected();

    const [success] = logsFor('Ran cloud function selectedInput ');
    const [failure] = logsFor('Failed running cloud function selectedInput ');
    for (const entry of [success, failure]) {
      expect(entry[1]).toContain(`\n  Input: ${JSON.stringify(selected)}\n`);
      expect(entry[2].params).toEqual(selected);
      expect(JSON.stringify(entry)).not.toContain('excluded-');
    }
    expect(success[0]).toBe('warn');
    expect(success[2].cleanParams).toBe(JSON.stringify(selected));
    expect(failure[0]).toBe('error');
    expect(failure[2].error.code).toBe(Parse.Error.VALIDATION_ERROR);
  });

  it('treats an empty list as selecting no keys and true as selecting all keys', async () => {
    Parse.Cloud.define('noKeys', () => 'ok', { logParams: [] });
    Parse.Cloud.define('allKeys', () => 'ok', { logParams: true });
    const params = { limit: 0 };
    await Parse.Cloud.run('noKeys', params);
    await Parse.Cloud.run('allKeys', params);
    expect(logsFor('Ran cloud function noKeys ')[0][2].params).toEqual({});
    expect(logsFor('Ran cloud function allKeys ')[0][2].params).toEqual(params);
  });

  it('can log the input alone or select fields independently on both sides', async () => {
    const result = { count: 0, details: 'excluded-result' };
    const params = { limit: 1, cursor: 'full-input' };
    Parse.Cloud.define('inputOnly', () => result, { logResult: false });
    Parse.Cloud.define('selectedFields', () => result, {
      logParams: ['limit'],
      logResult: ['count', 'missing', 'toString'],
    });

    expect(await Parse.Cloud.run('inputOnly', params)).toEqual(result);
    expect(await Parse.Cloud.run('selectedFields', params)).toEqual(result);

    const [inputOnly] = logsFor('Ran cloud function inputOnly ');
    expect(inputOnly[2].params).toEqual(params);
    expect(inputOnly[1]).not.toContain('Result:');
    expect(Object.hasOwn(inputOnly[2], 'output')).toBeFalse();
    expect(Object.hasOwn(inputOnly[2], 'cleanOutput')).toBeFalse();
    expect(JSON.stringify(inputOnly)).not.toContain('excluded-result');

    const [selected] = logsFor('Ran cloud function selectedFields ');
    expect(selected[1]).toContain('\n  Input: {"limit":1}\n  Result: {"count":0}');
    expect(selected[2].params).toEqual({ limit: 1 });
    expect(selected[2].output).toEqual({ count: 0 });
    expect(selected[2].cleanOutput).toBe('{"count":0}');
    expect(JSON.stringify(selected)).not.toContain('excluded-result');
    expect(JSON.stringify(selected)).not.toContain('full-input');
  });

  it('projects each result row and logs an empty object for values without selected fields', async () => {
    Parse.Cloud.define('rows', ({ params }) => params.value, {
      logParams: false,
      logResult: ['id', 'info', 'nested.key', 'password'],
    });
    const rows = [
      { id: 2, info: { active: false }, nested: { key: 'excluded' }, password: 'excluded' },
      { id: 1, 'nested.key': 'literal', hidden: 'excluded' },
      'excluded',
      null,
    ];
    const projected = [
      { id: 2, info: { active: false }, password: '********' },
      { id: 1, 'nested.key': 'literal' },
      {},
      {},
    ];
    const cases = [[rows, projected], ['excluded', {}], [null, {}]];
    for (const [value, logged] of cases) {
      expect(await Parse.Cloud.run('rows', { value })).toEqual(value);
      const entry = logsFor('Ran cloud function rows ').pop();
      expect(entry[1]).toContain(`\n  Result: ${JSON.stringify(logged)}`);
      expect(entry[2].output).toEqual(logged);
      expect(entry[2].cleanOutput).toBe(JSON.stringify(logged));
      expect(JSON.stringify(entry)).not.toContain('excluded');
    }
  });

  it('accepts an empty result allowlist and rejects invalid settings at definition time', async () => {
    Parse.Cloud.define('noResultFields', () => ({ id: 1 }), { logResult: [] });
    expect(await Parse.Cloud.run('noResultFields')).toEqual({ id: 1 });
    expect(logsFor('Ran cloud function noResultFields ')[0][2].output).toEqual({});
    for (const logResult of [null, 'id', {}, ['id', 5], ['']]) {
      expect(() => Parse.Cloud.define('invalid', () => {}, { logResult })).toThrow(
        'Invalid logResult for Cloud Function. Expected a boolean or an array of non-empty field names.'
      );
    }
    expect(() => Parse.Cloud.beforeSave('TestObject', () => {}, { logResult: false })).toThrow(
      'logResult is not a supported parameter for Cloud Function validations.'
    );
  });

  it('keeps the logging options of the handler that received the request', async () => {
    Parse.Cloud.define(
      'redefined',
      () => {
        Parse.Cloud.define('redefined', () => 'new');
        return 'original';
      },
      { logLevel: 'warn', logParams: false, logResult: false }
    );
    const params = { limit: 1 };
    expect(await Parse.Cloud.run('redefined', params)).toBe('original');
    expect(await Parse.Cloud.run('redefined', params)).toBe('new');

    const [original, replacement] = logsFor('Ran cloud function redefined ');
    expect(original[0]).toBe('warn');
    expect(original[1]).not.toContain(' with:');
    expect(original[2].params).toBeUndefined();
    expect(original[2].output).toBeUndefined();
    expect(replacement[0]).toBe('info');
    expect(replacement[2].params).toEqual(params);
    expect(replacement[2].output).toBe('new');
  });

  it('rejects invalid logParams at definition time and rejects logParams on triggers', () => {
    for (const logParams of [null, 'status', {}, [1], ['']]) {
      expect(() => Parse.Cloud.define('invalid', () => {}, { logParams })).toThrow(
        'Invalid logParams for Cloud Function. Expected a boolean or an array of non-empty parameter names.'
      );
    }
    expect(() => Parse.Cloud.beforeSave('TestObject', () => {}, { logParams: false })).toThrow(
      'logParams is not a supported parameter for Cloud Function validations.'
    );
  });
});
