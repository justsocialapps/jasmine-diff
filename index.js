var diff = require('diff')

/**
 * Return type of given value.
 *
 * @param {*} val Value to identify
 * @return {string}
 */
function getType (val) {
  if (val === null) {
    return 'null'
  } else if (val === void 0) {
    return 'undefined'
  }
  return Object.prototype.toString.call(val)
    .replace(/^\[.+\s(.+?)]$/, '$1')
    .toLowerCase()
}

function Value (val, parent, opts) {
  var obj = Object.create(Value.prototype)
  opts = opts || {}
  obj.value = val
  obj.parent = parent
  obj.type = getType(val)
  obj.key = opts.key
  obj.length = opts.length !== undefined ? opts.length : (val && val.length)
  return obj
}

function traverse (value, v) {
  var state = {}
  var visitor = v.visitor

  function traverseValue (val, parent, opts) {
    var wrapper = Value(val, parent, opts)
    var enterFn = wrapper.type + 'Enter'
    var exitFn = wrapper.type + 'Exit'
    var keys

    if (wrapper.type === 'object') {
      keys = Object.keys(wrapper.value).sort()
      wrapper.length = keys.length
    }

    if (visitor[enterFn]) {
      visitor[enterFn](wrapper, state)
    } else if (visitor.otherEnter) {
      visitor.otherEnter(wrapper, state)
    }

    switch (wrapper.type) {
      case 'array':
        wrapper.value.forEach(function (child, i) {
          traverseValue(child, wrapper, { key: i })
        })
        break

      case 'object':
        keys.forEach(function (key) {
          traverseValue(wrapper.value[key], wrapper, { key: key })
        })
        break

      default:
        /* do nothing */
        break
    }

    if (visitor[exitFn]) {
      visitor[exitFn](wrapper, state)
    }
  }

  if (v.pre) { v.pre.call(null, state) }
  traverseValue(value, null, null)
  if (v.post) { v.post.call(null, state) }
}

function repeat (n, str) {
  var result = ''
  while (n > 0) {
    result += str
    n -= 1
  }
  return result
}

function prettyPrintVisitor (pp, spaces) {
  var visitor = {}
  visitor.pre = function (state) {
    state.result = ''
    state.depth = 0
  }
  visitor.visitor = {
    arrayEnter: function (val, state) {
      if (val.key !== undefined) {
        state.result += repeat(state.depth * spaces, ' ')
        if (val.parent.type === 'object') {
          state.result += "'" + val.key + "': "
        }
      }
      if (val.length === 0) {
        state.result += '[]\n'
        return
      }
      state.result += '[\n'
      state.depth += 1
    },
    arrayExit: function (val, state) {
      if (val.length === 0) { return }
      state.depth -= 1
      state.result += repeat(state.depth * spaces, ' ') + ']\n'
    },
    objectEnter: function (val, state) {
      if (val.key !== undefined && val.parent.type === 'object') {
        state.result += repeat(state.depth * spaces, ' ') + "'" + val.key + "': "
      }
      if (val.length === 0) {
        state.result += '{}\n'
        return
      }
      state.result += '{\n'
      state.depth += 1
    },
    objectExit: function (val, state) {
      if (val.length === 0) { return }
      state.depth -= 1
      state.result += repeat(state.depth * spaces, ' ') + '}\n'
    },
    otherEnter: function (val, state) {
      state.result += repeat(state.depth * spaces, ' ')
      if (val.key !== undefined && val.parent.type === 'object') {
        state.result += "'" + val.key + "': "
      }
      state.result += pp(val.value) + '\n'
    }
  }
  visitor.post = function (state) {
    visitor.result = state.result.trim()
  }
  return visitor
}

function createStringifier (pp, spaces) {
  return function stringify (value) {
    var visitor = prettyPrintVisitor(pp, spaces)
    traverse(value, visitor)
    return visitor.result
  }
}

/**
 * Return whether value should be diffed.
 *
 * @param {*} val Value to test
 * @return {boolean}
 */
function isDiffable (val) {
  var type = getType(val)
  return type === 'object' || type === 'array'
}

function lpad (str, width) {
  while (String(str).length < width) {
    str = ' ' + str
  }
  return str
}

function red (str) {
  return '\x1B[31m' + str + '\x1B[0m'
}

function green (str) {
  return '\x1B[32m' + str + '\x1B[0m'
}

function identity (x) {
  return x
}

/**
 * Return unified diff of actual vs expected.
 *
 * @param {*} actual Actual value
 * @param {*} expected Expected value
 * @param {function} formatAdd Addition formatter
 * @param {function} formatRem Removal formatter
 * @return {string}
 */
function unifiedDiff (actual, expected, formatAdd, formatRem) {
  return [
    formatAdd('+ expected'),
    formatRem('- actual'),
    ''
  ]
  .concat(
    diff.createPatch('string', actual, expected)
      .split('\n')
      .slice(4)
      .filter(function (line) {
        return line[0] === '+' || line[0] === '-'
      })
      .map(function (line) {
        return line[0] === '+' ? formatAdd(line) : formatRem(line)
      })
  )
  .join('\n')
}

/**
 * Return inline diff of actual vs expected.
 *
 * @param {*} actual Actual value
 * @param {*} expected Expected value
 * @param {function} formatAdd Addition formatter
 * @param {function} formatRem Removal formatter
 * @return {string}
 */
function inlineDiff (actual, expected, formatAdd, formatRem) {
  var result = diff.diffWordsWithSpace(actual, expected)
    .map(function (line, idx) {
      return line.added ? formatAdd(line.value)
        : line.removed ? formatRem(line.value)
        : line.value
    })
    .join('')

  var lines = result.split('\n')
  if (lines.length > 4) {
    result = lines
      .map(function (line, idx) {
        return lpad(idx + 1, String(lines.length).length) + ' | ' + line
      })
      .join('\n')
  }

  return formatRem('actual') + ' ' + formatAdd('expected') + '\n\n' + result
}

/**
 * Jasmine Diff Matchers
 *
 * Main export. Returns jasmine matchers for overriding default functionality
 * to include additional error diffs where it makes sense.
 *
 * @param {object} j$ Jasmine instance
 * @return {object}
 */
module.exports = function jasmineDiffMatchers (j$, options) {
  if (!(j$ && j$.matchers && j$.addMatchers && j$.matchers.toEqual)) {
    throw new Error('Jasmine Diff Matchers must be initialized with Jasmine v2 instance')
  }

  var origToEqual = j$.matchers.toEqual
  var opts = {
    colors: options && options.colors === true,
    inline: options && options.inline === true,
    spaces: 2
  }
  var annotateAdd = opts.colors ? green : identity
  var annotateRemove = opts.colors ? red : identity
  var errorDiff = opts.inline ? inlineDiff : unifiedDiff
  var stringify = createStringifier(j$.pp, opts.spaces)

  function toEqual (util, customEqualityTesters) {
    function defaultMessage (actual, expected) {
      return 'Expected ' + j$.pp(expected) + ' to equal ' + j$.pp(actual) + '.'
    }

    return {
      compare: function (actual, expected) {
        var result = origToEqual(util, customEqualityTesters).compare(actual, expected)

        if (result.pass || !(isDiffable(actual) && isDiffable(expected))) {
          return result
        }

        result.message = (result.message || defaultMessage(actual, expected)) +
          '\n\n' + errorDiff(stringify(actual), stringify(expected), annotateAdd, annotateRemove) + '\n'

        return result
      }
    }
  }

  return {
    toEqual: toEqual
  }
}
