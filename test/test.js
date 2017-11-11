const Should = require('should')
const Hapi = require('hapi')
const Path = require('path')
const Joi = require('joi')
const _ = require('lodash')
const Locale = require('../index')

describe('Localization', function () {
  describe('Usage of locale in hapi', function () {
    const translateStringEn = "All's well that ends well."
    const translateStringDe = 'Ende gut, alles gut.'
    const translateStringFr = 'Tout est bien qui finit bien.'

    const server = Hapi.server({port: 8047})
    server.register(require('vision'))
    server.views({
      engines: {
        jade: require('pug')
      },
      path: Path.join(__dirname, 'views')
    })

    server.route({
      method: 'GET',
      path: '/no/language-code/path/parameter',
      handler: async (request) => {
        return {
          locale: request.i18n.getLocale(),
          message: request.i18n.__(translateStringEn)
        }
      }
    })
    server.route({
      method: 'GET',
      path: '/{languageCode}/localized/resource',
      handler: async (request) => {
        return {
          locale: request.i18n.getLocale(),
          requestedLocale: request.params.languageCode,
          message: request.i18n.__(translateStringEn)
        }
      }
    })
    server.route({
      method: 'GET',
      path: '/{languageCode}/localized/view',
      handler: async (request, h) => {
        return h.view('test')
      }
    })
    server.route({
      method: 'POST',
      path: '/{languageCode}/localized/validation',
      handler: async () => {
      },
      config: {
        validate: {
          payload: {
            param: Joi.string().required()
          },
          failAction: function (request, h, error) {
            return h.response(request.i18n.__('Validation failed')).code(400).takeover()
          }
        }
      }
    })
    server.route({
      method: 'GET',
      path: '/localized/with/headers',
      handler: async (request) => {
        return {
          locale: request.i18n.getLocale(),
          requestedLocale: request.headers['language'],
          message: request.i18n.__(translateStringEn)
        }
      }
    })

    server.route({
      method: 'GET',
      path: '/localized/with/query',
      handler: async (request) => {
        return {
          locale: request.i18n.getLocale(),
          requestedLocale: request.query['lang'],
          message: request.i18n.__(translateStringEn)
        }
      }
    })

    it('can be added as plugin', async () => {
      const plugin = await server.register([
        {
          plugin: Locale,
          options: {
            locales: ['de', 'en', 'fr'],
            directory: Path.join(__dirname, '/locales'),
            languageHeaderField: 'language',
            queryParameter: 'lang'
          }
        }]
      )

      Should.equal(plugin, undefined)
    })

    it('extracts the default locale from the configured locales', function () {
      Should.throws(function () {
        Locale.extractDefaultLocale()
      }, Error)
      Should.throws(function () {
        Locale.extractDefaultLocale([])
      }, Error)
      Locale.extractDefaultLocale(['fr', 'de']).should.equal('fr')
    })

    it('uses the default locale if no language code path parameter is available', async () => {
      const response = await server.inject(
        {
          method: 'GET',
          url: '/no/language-code/path/parameter'
        }
      )
      response.result.locale.should.equal('de')
      response.result.message.should.equal(translateStringDe)
    })

    it('uses the requested locale if language code is provided', async () => {
      const response = await server.inject(
        {
          method: 'GET',
          url: '/fr/localized/resource'
        }
      )

      response.result.locale.should.equal('fr')
      response.result.requestedLocale.should.equal('fr')
      response.result.message.should.equal(translateStringFr)
    })

    it('uses the requested locale if language code is provided in headers', async () => {
      let response = await server.inject(
        {
          method: 'GET',
          url: '/localized/with/headers',
          headers: {
            'language': 'fr'
          }
        }
      )

      response.result.locale.should.equal('fr')
      response.result.requestedLocale.should.equal('fr')
      response.result.message.should.equal(translateStringFr)

      response = await server.inject(
        {
          method: 'GET',
          url: '/localized/with/headers',
          headers: {}
        }
      )

      response.result.locale.should.equal('de')
      response.result.message.should.equal(translateStringDe)
    })

    it('uses the language query parameter over the header parameter because this is more explicit', async () => {
      const response = await server.inject(
        {
          method: 'GET',
          url: '/localized/with/query?lang=fr'
        }
      )

      response.result.locale.should.equal('fr')
      response.result.requestedLocale.should.equal('fr')
      response.result.message.should.equal(translateStringFr)
    })

    it('uses the language path parameter over the header parameter because this is more explicit', async () => {
      const response = await server.inject(
        {
          method: 'GET',
          url: '/fr/localized/resource',
          headers: {
            'language': 'en'
          }
        }
      )

      response.result.locale.should.equal('fr')
      response.result.requestedLocale.should.equal('fr')
      response.result.message.should.equal(translateStringFr)
    })

    it('translates localized strings in jade templates', async () => {
      const response = await server.inject(
        {
          method: 'GET',
          url: '/fr/localized/view'
        }
      )

      response.statusCode.should.equal(200)
      response.result.should.equal('<!DOCTYPE html><html lang="fr"><body><p>Tout est bien qui finit bien.</p></body></html>')
    })

    it('returns status code NOT-FOUND if the requested locale is not available', async () => {
      const response = await server.inject(
        {
          method: 'GET',
          url: '/en-US/localized/resource'
        }
      )

      response.result.statusCode.should.equal(404)
      response.result.message.should.equal('No localization available for en-US')
    })

    it('is available in the validation failAction handler ', async () => {
      const response = await server.inject(
        {
          method: 'POST',
          url: '/de/localized/validation'
        }
      )

      response.statusCode.should.equal(400)
      response.result.should.equal('Prüfung fehlgeschlagen')
    })

    it('must a sure correct localization when processing requests concurrently', async () => {
      const numIterations = 200
      const numRequestsPerIteration = 3
      const numTotalRequests = numIterations * numRequestsPerIteration
      let numProcessedRequests = 0
      let numErrorsWrongDefaultLocale = 0
      let numErrorsWrongTranslation = 0
      let numErrorsWrongRequestedLocale = 0

      const requests = _.flatten(Array.apply(null, {length: numIterations}).map(() => {
        return [
          new Promise(resolve => {
            server.inject({ method: 'GET', url: '/no/language-code/path/parameter' })
              .then(response => {
                if (response.result.locale !== 'de') {
                  ++numErrorsWrongDefaultLocale
                }
                if (response.result.message !== translateStringDe) {
                  ++numErrorsWrongTranslation
                }
                numProcessedRequests++
                response.result.locale.should.equal('de')
                resolve(response)
              })
          }),
          new Promise(resolve => {
            server.inject({ method: 'GET', url: '/en/localized/resource' })
              .then(response => {
                if (response.result.locale !== 'en') {
                  ++numErrorsWrongRequestedLocale
                }
                if (response.result.message !== translateStringEn) {
                  ++numErrorsWrongTranslation
                }
                numProcessedRequests++
                response.result.locale.should.equal('en')
                resolve(response)
              })
          }),
          new Promise(resolve => {
            server.inject({ method: 'GET', url: '/fr/localized/resource' })
              .then(response => {
                if (response.result.locale !== 'fr') {
                  ++numErrorsWrongRequestedLocale
                }
                numProcessedRequests++
                response.result.locale.should.equal('fr')
                resolve(response)
              })
          })
        ]
      }))

      await Promise.all(requests)

      numProcessedRequests.should.equal(numTotalRequests)
      numErrorsWrongDefaultLocale.should.equal(0)
      numErrorsWrongRequestedLocale.should.equal(0)
    })
  })
})
