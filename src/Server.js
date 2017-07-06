'use strict'

const Express = require('express')
const BodyParser = require('body-parser')
const exec = require('child_process').exec
const path = require('path')
const getEndpoints = require('./endpoints/get')

class Server {
  constructor (options) {
    this.options = Object.assign({ port: 5005 }, options)
    this.functions = []
    this.log = console.log
  }
  // Starts the server
  start () {
    if (this.functions.length === 0) {
      this.log('No Lambdas with Alexa-Skill or HTTP events found')
      return
    }
    this.app = Express()
    this.app.use(BodyParser.json())
    this.functions.forEach(func =>
      func.endpoints.forEach(endpoint => this._attachEndpoint(func, endpoint))
    )
    this.app.listen(this.options.port, _ => {
      this.log(`Listening on port ${this.options.port} for requests 🚀`)
      this.log('----')
      this.functions.forEach(func => {
        this.log(`${func.name}:`)
        func.endpoints.forEach(endpoint => {
          this.log(`  ${endpoint.method} http://localhost:${this.options.port}${endpoint.path}`)
        })
      })
      this.log('----')
    })
  }
  // Sets functions, including endpoints, using the serverless config and service path
  setFunctions (serverlessConfig, servicePath) {
    this.functions = Object.keys(serverlessConfig.functions).map(name => {
      let functionConfig = serverlessConfig.functions[name]
      let handlerParts = functionConfig.handler.split('.')
      return {
        name: name,
        config: serverlessConfig.functions[name],
        handlerModulePath: path.join(servicePath, handlerParts[0]),
        handlerFunctionName: handlerParts[1]
      }
    }).map(func =>
      Object.assign({}, func, { endpoints: getEndpoints(func) })
    ).filter(func =>
      func.endpoints.length > 0
    )
  }
  // Attaches HTTP endpoint to Express
  _attachEndpoint (func, endpoint) {
    // Validate method and path
    /* istanbul ignore next */
    if (!endpoint.method || !endpoint.path) {
      return this.log(`Endpoint ${endpoint.type} for function ${func.name} has no method or path`)
    }
    // Add HTTP endpoint to Express
    this.app[endpoint.method.toLowerCase()](endpoint.path, (request, response) => {
      this.log(`${endpoint}`)
      // Execute Lambda with corresponding event, forward response to Express
      let lambdaEvent = endpoint.getLambdaEvent(request)
      this._executeLambdaHandler(func, lambdaEvent).then(result => {
        this.log(' ➡ Success')
        if (process.env.SLS_DEBUG) console.info(result)
        endpoint.handleLambdaSuccess(response, result)
      }).catch(error => {
        this.log(` ➡ Failure: ${error.message}`)
        if (process.env.SLS_DEBUG) {
          console.error(error.stderr || error.stdout || error.stack)
        }
        endpoint.handleLambdaFailure(response, error)
      })
    })
  }
  // Loads and executes the Lambda handler
  _executeLambdaHandler (func, event) {
    return new Promise((resolve, reject) => {
      let data = JSON.stringify(event)
      var command = `serverless invoke local -f ${func.name} -d '${data}'`
      if (this.options.stage) {
        command += ` --stage ${this.options.stage}`
      }
      if (this.options.region) {
        command += ` --region ${this.options.region}`
      }
      if (process.env.SLS_DEBUG) {
        command = `SLS_DEBUG=${process.env.SLS_DEBUG} ${command}`
      }
      exec(command, (error, stdout, stderr) => {
        if (error) {
          let invocationError = new Error(`Error invoking ${func.name} function`)
          Object.assign(invocationError, { stderr, stdout })
          reject(invocationError)
        } else {
          if (idx > -1) {
            resolve(stdout.substr(idx))
          } else {
            resolve(stdout)
          }
        }
      })
    })
  }
}

module.exports = Server
