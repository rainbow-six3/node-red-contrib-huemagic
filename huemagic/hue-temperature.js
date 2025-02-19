module.exports = function(RED)
{
	"use strict";

	function HueTemperature(config)
	{
		RED.nodes.createNode(this, config);

		const scope = this;
		const bridge = RED.nodes.getNode(config.bridge);
		const async = require('async');

		// SAVE LAST COMMAND
		this.lastCommand = null;

		//
		// CHECK CONFIG
		if(bridge == null)
		{
			this.status({fill: "red", shape: "ring", text: "hue-temperature.node.not-configured"});
			return false;
		}

		//
		// UNIVERSAL MODE?
		if(!config.sensorid)
		{
			this.status({fill: "grey", shape: "dot", text: "hue-temperature.node.universal"});
		}

		//
		// UPDATE STATE
		if(typeof bridge.disableupdates != 'undefined'||bridge.disableupdates == false)
		{
			this.status({fill: "grey", shape: "dot", text: "hue-temperature.node.init"});
		}

		//
		// SUBSCRIBE TO UPDATES FROM THE BRIDGE
		bridge.subscribe(scope, "temperature", config.sensorid, function(info)
		{
			let currentState = bridge.get("temperature", info.id);

			// RESOURCE FOUND?
			if(currentState !== false)
			{
				// SEND MESSAGE
				if(!config.skipevents && (config.initevents || info.suppressMessage == false))
				{
					// SET LAST COMMAND
					if(scope.lastCommand !== null)
					{
						currentState.command = scope.lastCommand;
					}

					// SEND STATE
					scope.send(currentState);

					// RESET LAST COMMAND
					scope.lastCommand = null;
				}

				// NOT IN UNIVERAL MODE? -> CHANGE UI STATES
				if(config.sensorid)
				{
					if(currentState.payload.reachable == false)
					{
						scope.status({fill: "red", shape: "ring", text: "hue-temperature.node.not-reachable"});
					}
					else if(currentState.payload.active == false)
					{
						scope.status({fill: "red", shape: "ring", text: "hue-temperature.node.deactivated"});
					}
					else
					{
						var color = "yellow";

						if(currentState.payload.celsius < 21)
						{
							color = "blue";
						}
						else if(currentState.payload.celsius < 26)
						{
							color = "yellow";
						}
						else
						{
							color = "red";
						}

						scope.status({fill: color, shape: "dot", text: currentState.payload.celsius+" °C / "+currentState.payload.fahrenheit+" °F"});
					}
				}
			}
		});

		//
		// ON COMMAND
		this.on('input', function(msg, send, done)
		{
			// REDEFINE SEND AND DONE IF NOT AVAILABLE
			send = send || function() { scope.send.apply(scope,arguments); }
			done = done || function() { scope.done.apply(scope,arguments); }

			// SAVE LAST COMMAND
			scope.lastCommand = RED.util.cloneMessage(msg);

			// CREATE PATCH
			let patchObject = {};

			// DEFINE SENSOR ID & CURRENT STATE
			const tempSensorID = (!config.sensorid && typeof msg.topic != 'undefined' && bridge.validResourceID.test(msg.topic) === true) ? msg.topic : config.sensorid;
			if(!tempSensorID)
			{
				scope.error("Please submit a valid sensor ID.");
				return false;
			}

			let currentState = bridge.get("temperature", tempSensorID);
			if(!currentState)
			{
				scope.error("The sensor in not yet available. Please wait until HueMagic has established a connection with the bridge or check whether the resource ID in the configuration is valid.");
				return false;
			}

			// GET CURRENT STATE
			if( (typeof msg.payload != 'undefined' && typeof msg.payload.status != 'undefined') || (typeof msg.__user_inject_props__ != 'undefined' && msg.__user_inject_props__ == "status") )
			{
				// SET LAST COMMAND
				if(scope.lastCommand !== null)
				{
					currentState.command = scope.lastCommand;
				}

				// SEND STATE
				scope.send(currentState);

				// RESET LAST COMMAND
				scope.lastCommand = null;

				if(done) { done(); }
				return true;
			}

			// TURN ON / OFF
			if((msg.payload === true || msg.payload === false) && (msg.payload != currentState.payload.active))
			{
				// PREPARE PATCH
				patchObject["enabled"] = (msg.payload == true);
			}

			//
			// SHOULD PATCH?
			if(Object.values(patchObject).length > 0)
			{
				// CHANGE NODE UI STATE
				if(config.sensorid)
				{
					scope.status({fill: "grey", shape: "ring", text: "hue-temperature.node.command"});
				}

				// PATCH!
				async.retry({
					times: 5,
					errorFilter: function(err) {
						return (err.status == 503 || err.status == 429);
					},
					interval: function(retryCount) { return 750*retryCount; }
				},
				function(callback, results)
				{
					bridge.patch("temperature", tempSensorID, patchObject)
					.then(function() { callback(null, true); })
					.catch(function(errors) { callback(errors, null); });
				},
				function(errors, success)
				{
					if(errors)
					{
						scope.error(errors);
					}
					else if(done)
					{
						done();
					}
				});
			}
			else
			{
				// SET LAST COMMAND
				if(scope.lastCommand !== null)
				{
					currentState.command = scope.lastCommand;
				}

				// SEND STATE
				scope.send(currentState);

				// RESET LAST COMMAND
				scope.lastCommand = null;

				if(done) { done(); }
			}
		});

		// ON NODE UNLOAD : UNSUBSCRIBE FROM BRIDGE
		this.on ('close', function (done)
		{
			bridge.unsubscribe(scope);
			done();
		});
	}

	RED.nodes.registerType("hue-temperature", HueTemperature);
}
