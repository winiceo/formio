'use strict';

var mongoose = require('mongoose');
var _ = require('lodash');
var moment = require('moment');
var nodeUrl = require('url');
var Q = require('q');
var formioUtils = require('formio-utils');
var deleteProp = require('delete-property').default;
var debug = {
  getUrlParams: require('debug')('formio:util:getUrlParams'),
  removeProtectedFields: require('debug')('formio:util:removeProtectedFields')
};

module.exports = {
  deleteProp: deleteProp,

  /**
   * A wrapper around console.log that gets ignored by eslint.
   *
   * @param {*} content
   *   The content to pass to console.log.
   */
  log: function(content) {
    if (process.env.TEST_SUITE) {
      return;
    }

    /* eslint-disable */
    console.log(content);
    /* eslint-enable */
  },

  /**
   * A wrapper around console.error that gets ignored by eslint.
   *
   * @param {*} content
   *   The content to pass to console.error.
   */
  error: function(content) {
    /* eslint-disable */
    console.error(content);
    /* eslint-enable */
  },

  /**
   * Returns the URL alias for a form provided the url.
   */
  getAlias: function(req, reservedForms) {
    var formsRegEx = new RegExp('\/(' + reservedForms.join('|') + ').*', 'i');
    var alias = req.url.substr(1).replace(formsRegEx, '');
    var additional = req.url.substr(alias.length + 1);
    if (!additional && req.method === 'POST') {
      additional = '/submission';
    }
    return {
      alias: alias,
      additional: additional
    };
  },

  /**
   * Create a sub-request object from the original request.
   *
   * @param req
   */
  createSubRequest: function(req) {
    // Determine how many child requests have been made.
    var childRequests = req.childRequests || 0;

    // Break recursive child requests.
    if (childRequests > 5) {
      return null;
    }

    // Save off formio for fast cloning...
    var cache = req.formioCache;
    delete req.formioCache;

    // Clone the request.
    var childReq = _.clone(req, true);

    // Add the parameters back.
    childReq.formioCache = cache;
    childReq.user = req.user;
    childReq.modelQuery = null;
    childReq.countQuery = null;
    childReq.childRequests = ++childRequests;

    // Delete the actions cache.
    delete childReq.actions;

    // Delete default resourceData from actions
    // otherwise you get an endless loop
    delete childReq.resourceData;

    // Delete skipResource so child requests can decide
    // this for themselves
    delete childReq.skipResource;

    return childReq;
  },

  /**
   * Iterate through each component within a form.
   *
   * @param {Object} components
   *   The components to iterate.
   * @param {Function} fn
   *   The iteration function to invoke for each component.
   * @param {Boolean} includeAll
   *   Whether or not to include layout components.
   * @param {String} path
   *   @TODO
   */
  eachComponent: formioUtils.eachComponent,

  /**
   * Get a component by its key
   *
   * @param {Object} components
   *   The components to iterate.
   * @param {String} key
   *   The key of the component to get.
   *
   * @returns {Object}
   *   The component that matches the given key, or undefined if not found.
   */
  getComponent: formioUtils.getComponent,

  /**
   * Flatten the form components for data manipulation.
   *
   * @param {Object} components
   *   The components to iterate.
   * @param {Boolean} includeAll
   *   Whether or not to include layout components.
   *
   * @returns {Object}
   *   The flattened components map.
   */
  flattenComponents: formioUtils.flattenComponents,

  /**
   * Get the value for a component key, in the given submission.
   *
   * @param {Object} submission
   *   A submission object to search.
   * @param {String} key
   *   A for components API key to search for.
   */
  getValue: formioUtils.getValue,

  /**
   * Determine if a component is a layout component or not.
   *
   * @param {Object} component
   *   The component to check.
   *
   * @returns {Boolean}
   *   Whether or not the component is a layout component.
   */
  isLayoutComponent: formioUtils.isLayoutComponent,

  /**
   * Return the objectId.
   *
   * @param id
   * @returns {*}
   * @constructor
   */
  ObjectId: function(id) {
    return _.isObject(id)
      ? id
      : mongoose.Types.ObjectId(id);
  },

  /**
   * Search the request headers for the given key.
   *
   * @param req
   *   The Express request object.
   * @param key
   *   The key to search for in the headers.
   *
   * @return
   *   The header value if found or false.
   */
  getHeader: function(req, key) {
    if (typeof req.headers[key] !== 'undefined') {
      return req.headers[key];
    }

    return false;
  },

  renderFormSubmission: function(data, components) {
    var comps = this.flattenComponents(components);
    var submission = '<table border="1" style="width:100%">';
    _.each(comps, function(component, key) {
      // Containers will get rendered as flat.
      if (
        (component.type === 'container') ||
        (component.type === 'button') ||
        (component.type === 'hidden')
      ) {
        return;
      }
      var cmpValue = this.renderComponentValue(data, key, comps);
      if (typeof cmpValue.value === 'string') {
        submission += '<tr>';
        submission += '<th style="padding: 5px 10px;">' + cmpValue.label + '</th>';
        submission += '<td style="width:100%;padding:5px 10px;">' + cmpValue.value + '</td>';
        submission += '</tr>';
      }
    }.bind(this));
    submission += '</table>';
    return submission;
  },

  /**
   * Renders a specific component value, which is also able
   * to handle Containers, Data Grids, as well as other more advanced
   * components such as Signatures, Dates, etc.
   *
   * @param data
   * @param key
   * @param components
   * @returns {{label: *, value: *}}
   */
  renderComponentValue: function(data, key, components) {
    var value = _.get(data, key);
    if (!value) {
      value = '';
    }
    var compValue = {
      label: key,
      value: value
    };
    if (!components.hasOwnProperty(key)) {
      return compValue;
    }
    var component = components[key];
    compValue.label = component.label || component.placeholder || component.key;
    if (component.multiple) {
      components[key].multiple = false;
      compValue.value = _.map(value, function(subValue) {
        var subValues = {};
        subValues[key] = subValue;
        return this.renderComponentValue(subValues, key, components).value;
      }.bind(this)).join(', ');
      return compValue;
    }

    switch (component.type) {
      case 'password':
        compValue.value = '--- PASSWORD ---';
        break;
      case 'address':
        compValue.value = compValue.value ? compValue.value.formatted_address : '';
        break;
      case 'signature':
        compValue.value = '<img src="' + value + '" />';
        break;
      case 'container':
        compValue.value = '<table border="1" style="width:100%">';
        _.each(value, function(subValue, subKey) {
          var subCompValue = this.renderComponentValue(value, subKey, components);
          compValue.value += '<tr>';
          compValue.value += '<th style="text-align:right;padding: 5px 10px;">' + subCompValue.label + '</th>';
          compValue.value += '<td style="width:100%;padding:5px 10px;">' + subCompValue.value + '</td>';
          compValue.value += '</tr>';
        }.bind(this));
        compValue.value += '</table>';
        break;
      case 'datagrid':
        compValue.value = '<table border="1" style="width:100%">';
        var columns = [];
        if (value.length > 0) {
          _.each(value[0], function(column, columnKey) {
            if (components.hasOwnProperty(columnKey)) {
              columns.push(components[columnKey]);
            }
          }.bind(this));
        }
        compValue.value += '<tr>';
        _.each(columns, function(column) {
          var subLabel = column.label || column.key;
          compValue.value += '<th style="padding: 5px 10px;">' + subLabel + '</th>';
        });
        compValue.value += '</tr>';
        _.each(value, function(subValue) {
          compValue.value += '<tr>';
          _.each(columns, function(column) {
            compValue.value += '<td style="padding:5px 10px;">';
            compValue.value += this.renderComponentValue(subValue, column.key, components).value;
            compValue.value += '</td>';
          }.bind(this));
          compValue.value += '</tr>';
        }.bind(this));
        compValue.value += '</table>';
        break;
      case 'datetime':
        var dateFormat = '';
        if (component.enableDate) {
          dateFormat = component.format.toUpperCase();
        }
        if (component.enableTime) {
          dateFormat += ' hh:mm:ss A';
        }
        if (dateFormat) {
          compValue.value = moment(value).format(dateFormat);
        }
        break;
      case 'radio':
      case 'select':
      case 'selectboxes':
        var values = [];
        if (component.hasOwnProperty('values')) {
          values = component.values;
        }
        else if (component.hasOwnProperty('data') && component.data.values) {
          values = component.data.values;
        }
        for (var i in values) {
          var subCompValue = values[i];
          if (subCompValue.value === value) {
            compValue.value = subCompValue.label;
            break;
          }
        }
        break;
      default:
        break;
    }

    if (component.protected) {
      compValue.value = '--- PROTECTED ---';
    }

    // Ensure the value is a string.
    compValue.value = compValue.value ? compValue.value.toString() : '';
    return compValue;
  },

  /**
   * Search the request query for the given key.
   *
   * @param req
   *   The Express request object.
   * @param key
   *   The key to search for in the query.
   *
   * @return
   *   The query value if found or false.
   */
  getQuery: function(req, key) {
    if (typeof req.query[key] !== 'undefined') {
      return req.query[key];
    }

    return false;
  },

  /**
   * Search the request parameters for the given key.
   *
   * @param req
   *   The Express request object.
   * @param key
   *   The key to search for in the parameters.
   *
   * @return
   *   The parameter value if found or false.
   */
  getParameter: function(req, key) {
    if (typeof req.params[key] !== 'undefined') {
      return req.params[key];
    }

    return false;
  },

  /**
   * Determine if the request has the given key set as a header or url parameter.
   *
   * @param req
   *   The Express request object.
   * @param key
   *   The key to search for.
   *
   * @return
   *   Return the value of the key or false if not found.
   */
  getRequestValue: function(req, key) {
    var ret = null;

    // If the header is present, return it.
    ret = this.getHeader(req, key);
    if (ret !== false) {
      return ret;
    }

    // If the url query is present, return it.
    ret = this.getQuery(req, key);
    if (ret !== false) {
      return ret;
    }

    // If the url parameter is present, return it.
    ret = this.getParameter(req, key);
    if (ret !== false) {
      return ret;
    }

    return false;
  },

  /**
   * Split the given URL into its key/value pairs.
   *
   * @param url
   *   The request url to split, typically req.url.
   *
   * @returns {{}}
   *   The key/value pairs of the request url.
   */
  getUrlParams: function(url) {
    var urlParams = {};
    if (!url) {
      return urlParams;
    }
    var parsed = nodeUrl.parse(url);
    var parts = parsed.pathname.split('/');
    debug.getUrlParams(parsed);

    // Remove element originating from first slash.
    parts = _.rest(parts);

    // Url is not symmetric, add an empty value for the last key.
    if ((parts.length % 2) !== 0) {
      parts.push('');
    }

    // Build key/value list.
    for (var a = 0; a < parts.length; a += 2) {
      urlParams[parts[a]] = parts[a + 1];
    }

    debug.getUrlParams(urlParams);
    return urlParams;
  },

  /**
   * Converts a form component key into a submission key
   * by putting .data. between each nested component
   * (ex: `user.name` becomes `user.data.name` in a submission)
   * @param key
   *   The key to convert
   * @return
   *   The submission key
   */
  getSubmissionKey: function(key) {
    return key.replace(/\./g, '.data.');
  },

  /**
   * Converts a submission key into a form component key
   * by replacing .data. with .
   * (ex: `user.data.name` becomes `user.name` in a submission)
   * @param key
   *   The key to convert
   * @return
   *   The form component key
   */
  getFormComponentKey: function(key) {
    return key.replace(/\.data\./g, '.');
  },

  /**
   * A promisified version of request. Use this if you need
   * to be able to mock requests for tests, as it's much easier
   * to mock this than the individual required 'request' modules
   * in each file.
   */
  request: Q.denodeify(require('request')),

  /**
   * Utility function to ensure the given id is always a BSON object.
   *
   * @param _id {String|Object}
   *   A mongo id as a string or object.
   *
   * @returns {Object}
   *   The mongo BSON id.
   */
  idToBson: function(_id) {
    return _.isObject(_id)
      ? _id
      : mongoose.Types.ObjectId(_id);
  },

  /**
   * Utility function to ensure the given id is always a string object.
   *
   * @param _id {String|Object}
   *   A mongo id as a string or object.
   *
   * @returns {String}
   *   The mongo string id.
   */
  idToString: function(_id) {
    return _.isObject(_id)
      ? _id.toString()
      : _id;
  },

  removeProtectedFields: function(form, action, submissions) {
    if (!(submissions instanceof Array)) {
      submissions = [submissions];
    }

    // Initialize our delete fields array.
    var modifyFields = [];

    // Iterate through all components.
    this.eachComponent(form.components, function(component, path) {
      path = 'data.' + path;
      if (component.protected) {
        debug.removeProtectedFields('Removing protected field:', component.key);
        modifyFields.push(deleteProp(path));
      }
      else if ((component.type === 'signature') && (action === 'index')) {
        modifyFields.push((function(fieldPath) {
          return function(sub) {
            var data = _.get(sub, fieldPath);
            _.set(sub, fieldPath, (!data || (data.length < 25)) ? '' : 'YES');
          };
        })(path));
      }
    }.bind(this), true);

    // Iterate through each submission once.
    if (modifyFields.length > 0) {
      _.each(submissions, function(submission) {
        _.each(modifyFields, function(modifyField) {
          modifyField(submission);
        });
      });
    }
  }
};
