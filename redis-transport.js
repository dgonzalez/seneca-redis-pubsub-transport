/* Copyright (c) 2014 Richard Rodger, MIT License */
"use strict";


var buffer = require('buffer')
var util   = require('util')
var net    = require('net')
var stream = require('stream')


var _        = require('underscore')
var redis    = require('redis')



module.exports = function( options ) {
  var seneca = this
  var plugin = 'redis-transport'

  var so        = seneca.options()
  var msgprefix = so.transport.msgprefix

  options = seneca.util.deepextend(
    {
      redis: {
        timeout:  so.timeout ? so.timeout-555 :  22222,
        type:     'redis',
        host:     'localhost',
        port:     6379,
      },
    },
    so.transport,
    options)
  

  var tu = seneca.export('transport/utils')


  seneca.add({role:'transport',hook:'listen',type:'redis'}, hook_listen_redis)
  seneca.add({role:'transport',hook:'client',type:'redis'}, hook_client_redis)

  // Legacy patterns
  seneca.add({role:'transport',hook:'listen',type:'pubsub'}, hook_listen_redis)
  seneca.add({role:'transport',hook:'client',type:'pubsub'}, hook_client_redis)



  function hook_listen_redis( args, done ) {
    var seneca         = this
    var type           = args.type
    var listen_options = _.extend({},options[args.type],args)

    var redis_in  = redis.createClient(listen_options.port,listen_options.host)
    var redis_out = redis.createClient(listen_options.port,listen_options.host)

    redis_in.on('message',function(channel,msgstr){
      var restopic = channel.replace(/_act$/,'_res')
      var data     = tu.parseJSON( seneca, 'listen-'+type, msgstr )

      tu.handle_request( seneca, data, listen_options, function(out){
        var outstr = tu.stringifyJSON( seneca, 'listen-redis', out )
        redis_out.publish(restopic,outstr)
      })
    })

    tu.listen_topics( seneca, args, listen_options, function(topic) {
      redis_in.subscribe( topic+'_act' )
    })

    seneca.log.info('listen', 'open', listen_options, seneca)

    done()
  }


  function hook_client_redis( args, clientdone ) {
    var seneca         = this
    var type           = args.type
    var client_options = _.extend({},options[type],args)

    tu.make_client( make_send, client_options, clientdone )

    function make_send( spec, topic ) {
      var redis_in  = redis.createClient(client_options.port,client_options.host)
      var redis_out = redis.createClient(client_options.port,client_options.host)

      redis_in.on('message',function(channel,msgstr){
        var input = tu.parseJSON(seneca,'client-'+type,msgstr)
        tu.handle_response( seneca, input, client_options )
      })

      redis_in.subscribe( msgprefix+topic+'_res' )

      return function( args, done ) {
        var outmsg = tu.prepare_request( this, args, done )

        var outstr   = tu.stringifyJSON( seneca, 'client-redis', outmsg )
        redis_out.publish( msgprefix+topic+'_act', outstr )
      }
    }
  }  


  return {
    name: plugin,
  }
}
