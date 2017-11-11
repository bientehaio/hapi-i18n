const I18n = require('i18n')
const Boom = require('boom')
const Hoek = require('hoek')
const _ = require('lodash')

exports.plugin = {
  register: async (server, options) => {
    let pluginOptions = {}
    if (options) {
      pluginOptions = options
    }
    I18n.configure(pluginOptions)

    const defaultLocale = pluginOptions.defaultLocale || exports.extractDefaultLocale(pluginOptions.locales)

    if (!pluginOptions.locales) {
      throw Error('No locales defined!')
    }

    server.ext({
      type: 'onPreAuth',
      method: (request, handler) => {
        request.i18n = {}
        I18n.init(request, request.i18n)
        request.i18n.setLocale(defaultLocale)
        if (request.params && request.params.languageCode) {
          if (_.includes(pluginOptions.locales, request.params.languageCode) === false) {
            return Boom.notFound('No localization available for ' + request.params.languageCode)
          }
          request.i18n.setLocale(request.params.languageCode)
        } else if (pluginOptions.queryParameter && request.query && request.query[pluginOptions.queryParameter]) {
          if (_.includes(pluginOptions.locales, request.query[pluginOptions.queryParameter]) === false) {
            return Boom.notFound('No localization available for ' + request.query[pluginOptions.queryParameter])
          }
          request.i18n.setLocale(request.query[pluginOptions.queryParameter])
        } else if (pluginOptions.languageHeaderField && request.headers[pluginOptions.languageHeaderField]) {
          const languageCode = request.headers[pluginOptions.languageHeaderField]
          if (languageCode) {
            request.i18n.setLocale(languageCode)
          }
        }
        return handler.continue
      }
    })

    server.ext({
      type: 'onPreResponse',
      method: (request, handler) => {
        if (!request.i18n || !request.response) {
          return handler.continue
        }
        const response = request.response
        if (response.variety === 'view') {
          response.source.context = Hoek.merge(response.source.context || {}, request.i18n)
          response.source.context.languageCode = request.i18n.getLocale()
        }
        return handler.continue
      }})
  },
  pkg: require('./package.json')
}

exports.extractDefaultLocale = function (allLocales) {
  if (!allLocales) {
    throw new Error('No locales defined!')
  }
  if (allLocales.length === 0) {
    throw new Error('Locales array is empty!')
  }
  return allLocales[0]
}
