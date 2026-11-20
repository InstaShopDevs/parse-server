// FunctionsRouter.js

var Parse = require('parse/node').Parse,
  triggers = require('../triggers');

import PromiseRouter from '../PromiseRouter';
import { promiseEnforceMasterKeyAccess, promiseEnsureIdempotency } from '../middlewares';
import { jobStatusHandler } from '../StatusHandler';
import _ from 'lodash';
import { logger } from '../logger';

function parseObject(obj, config) {
  if (Array.isArray(obj)) {
    return obj.map(item => {
      return parseObject(item, config);
    });
  } else if (obj && obj.__type == 'Date') {
    return Object.assign(new Date(obj.iso), obj);
  } else if (obj && obj.__type == 'File') {
    return Parse.File.fromJSON(obj);
  } else if (obj && obj.__type == 'Pointer' && config.encodeParseObjectInCloudFunction) {
    return Parse.Object.fromJSON({
      __type: 'Pointer',
      className: obj.className,
      objectId: obj.objectId,
    });
  } else if (obj && typeof obj === 'object') {
    return parseParams(obj, config);
  } else {
    return obj;
  }
}

function parseParams(params, config) {
  return _.mapValues(params, item => parseObject(item, config));
}

function selectLogFields(value, fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const selected = Object.fromEntries(
    fields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]])
  );
  if (Object.hasOwn(selected, 'password')) {
    // Mask the copy before stringifying it for the log.
    logger.maskSensitive([{ params: selected }]);
  }
  return selected;
}

function getLogPayload(label, value, fields) {
  if (fields === false) {
    return { line: '' };
  }
  if (Array.isArray(fields)) {
    value = Array.isArray(value)
      ? value.map(item => selectLogFields(item, fields))
      : selectLogFields(value, fields);
  }
  const text = logger.truncateLogMessage(JSON.stringify(value));
  const line = `\n  ${label}: ${text}`;
  return label === 'Input'
    ? { line, params: value, cleanParams: text }
    : { line, output: value, cleanOutput: text };
}

export class FunctionsRouter extends PromiseRouter {
  mountRoutes() {
    this.route(
      'POST',
      '/functions/:functionName',
      promiseEnsureIdempotency,
      FunctionsRouter.handleCloudFunction
    );
    this.route(
      'POST',
      '/jobs/:jobName',
      promiseEnsureIdempotency,
      promiseEnforceMasterKeyAccess,
      function (req) {
        return FunctionsRouter.handleCloudJob(req);
      }
    );
    this.route('POST', '/jobs', promiseEnforceMasterKeyAccess, function (req) {
      return FunctionsRouter.handleCloudJob(req);
    });
  }

  static handleCloudJob(req) {
    const jobName = req.params.jobName || req.body?.jobName;
    const applicationId = req.config.applicationId;
    const jobHandler = jobStatusHandler(req.config);
    const jobFunction = triggers.getJob(jobName, applicationId);
    if (!jobFunction) {
      throw new Parse.Error(Parse.Error.SCRIPT_FAILED, 'Invalid job.');
    }
    let params = Object.assign({}, req.body, req.query);
    params = parseParams(params, req.config);
    const request = {
      params: params,
      log: req.config.loggerController,
      headers: req.config.headers,
      ip: req.config.ip,
      jobName,
      message: jobHandler.setMessage.bind(jobHandler),
    };

    return jobHandler.setRunning(jobName).then(jobStatus => {
      request.jobId = jobStatus.objectId;
      // run the function async
      process.nextTick(() => {
        Promise.resolve()
          .then(() => {
            return jobFunction(request);
          })
          .then(
            result => {
              jobHandler.setSucceeded(result);
            },
            error => {
              jobHandler.setFailed(error);
            }
          );
      });
      return {
        headers: {
          'X-Parse-Job-Status-Id': jobStatus.objectId,
        },
        response: {},
      };
    });
  }

  static createResponseObject(resolve, reject) {
    return {
      success: function (result) {
        resolve({
          response: {
            result: Parse._encode(result),
          },
        });
      },
      error: function (message) {
        const error = triggers.resolveError(message);
        reject(error);
      },
    };
  }
  static handleCloudFunction(req) {
    const functionName = req.params.functionName;
    const applicationId = req.config.applicationId;
    const theFunction = triggers.getFunction(functionName, applicationId);

    if (!theFunction) {
      throw new Parse.Error(Parse.Error.SCRIPT_FAILED, `Invalid function: "${functionName}"`);
    }
    const validator = triggers.getValidator(functionName, applicationId);
    const { logLevel, logParams, logResult } =
      typeof validator === 'object' && validator ? validator : {};
    const successLogLevel = logLevel || req.config.logLevels.cloudFunctionSuccess;
    let params = Object.assign({}, req.body, req.query);
    params = parseParams(params, req.config);
    const request = {
      params: params,
      master: req.auth && req.auth.isMaster,
      user: req.auth && req.auth.user,
      installationId: req.info.installationId,
      log: req.config.loggerController,
      headers: req.config.headers,
      ip: req.config.ip,
      functionName,
      context: req.info.context,
    };

    return new Promise(function (resolve, reject) {
      const userString = req.auth && req.auth.user ? req.auth.user.id : undefined;
      const { success, error } = FunctionsRouter.createResponseObject(
        result => {
          try {
            if (successLogLevel !== 'silent') {
              const { line: inputLine, ...input } = getLogPayload('Input', params, logParams);
              const { line: resultLine, ...output } = getLogPayload(
                'Result',
                result.response.result,
                logResult
              );
              const summary = `Ran cloud function ${functionName} for user ${userString}`;
              const details = inputLine + resultLine;
              logger[successLogLevel](details ? `${summary} with:${details}` : summary, {
                functionName,
                ...input,
                user: userString,
                isMaster: req.auth && req.auth.isMaster,
                ...output,
              });
            }
            resolve(result);
          } catch (e) {
            reject(e);
          }
        },
        error => {
          try {
            if (req.config.logLevels.cloudFunctionError !== 'silent') {
              const { line, params: loggedParams } = getLogPayload('Input', params, logParams);
              logger[req.config.logLevels.cloudFunctionError](
                `Failed running cloud function ${functionName} for user ${userString} with:${line}\n  Error: ` +
                  JSON.stringify(error),
                {
                  functionName,
                  error,
                  ...(loggedParams && { params: loggedParams }),
                  user: userString,
                }
              );
            }
            reject(error);
          } catch (e) {
            reject(e);
          }
        }
      );
      const rolesPromise = req.auth ? req.auth.getUserRoles() : Promise.resolve([]);
      return rolesPromise.catch(() => [])
        .then((roles) => {
          request.roles = roles;
          return triggers.maybeRunValidator(request, functionName, req.auth);
        })
        .then(() => {
          return theFunction(request);
        })
        .then(success, error);
    });
  }
}
