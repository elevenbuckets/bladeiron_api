'use strict';

const fs = require('fs');
const path = require('path');
const rpc = require('rpc-websockets').Client;
const web3 = require('web3');
const w = new web3(); // for util functions only... :P

class BladeAPI {
	constructor(rpcport, rpchost, options) // options is an object 
	{
		// option import + setup
		this.configs = options;
		this.appName = options.appName;
		this.networkID = options.networkID;
		this.rpcport = rpcport;
		this.rpchost = rpchost;

		this.ready = false;
		this.client;
		this.userWallet = '0x';

		// Utilities
		this.toAscii = (input) => { return w.toAscii(input) }
		this.toHex   = (input) => { return w.toHex(input) }
		this.toBigNumber = (input) => { return w.toBigNumber(input) }
		this.toDecimal = (input) => { return w.toDecimal(input) }
		this.toWei = (input, unit = 'ether') => { return w.toWei(input, unit) }
		this.fromWei = (input, unit = 'ether') => { return w.fromWei(input, unit) }

		this.toAddress = address => {
                        let addr = String(this.toHex(this.toBigNumber(address)));

                        if (addr.length === 42) {
                                return addr
                        } else if (addr.length > 42) {
                                throw "Not valid address";
                        }

                        let pz = 42 - addr.length;
                        addr = addr.replace('0x', '0x' + '0'.repeat(pz));

                        return addr;
                }

		this.byte32ToAddress = (b) => { return this.toAddress(this.toHex(this.toBigNumber(String(b)))) }
        	this.byte32ToDecimal = (b) => { return this.toDecimal(this.toBigNumber(String(b))) }
        	this.byte32ToBigNumber = (b) => { return this.toBigNumber(String(b)) }
                this.bytes32ToAscii = (b) => { return this.toAscii(this.toHex(this.toBigNumber(String(b)))) }

		// BladeIron Setup functions
		this.connectRPC = () => 
		{
			try {
				this.client = new rpc('ws://' + this.rpchost + ':' + this.rpcport);

				const __ready = (resolve, reject) => 
				{
					this.client.on('open', () => { resolve(true) });
				}

				return new Promise(__ready);
			} catch (err) {
				console.log(err);
				return Promise.reject(false);
			}
		}

		this.init = (condType = "Sanity") => 
		{
			const __getABI = (ctrName = this.appName) =>
			{
				return [this.appName, this.configs.version, ctrName, path.join(this.configs.artifactDir, ctrName + '.json')]
			}

			const __newAppHelper = (ctrName = this.appName) => (condType = "Sanity") =>
			{
				let output = __getABI(ctrName); let condition = {};
				let _c = this.configs.contracts.filter( (c) => { return (c.ctrName === ctrName && c.conditions.indexOf(condType) !== -1) });
				if (_c.length === 1) {
					condition = { [condType]: path.join(this.configs.conditionDir, this.appName, ctrName, condType + '.js') }; 
				}

				return [...output, condition];
			}

			return this.client.call('full_checks', [])
      				   .then((rc) => {
      				   	   if (!rc.result.geth || !rc.result.ipfs) {
						console.log(rc);
						throw "Server not fully functioning";
					   }
      				   })
      				   .then(() => {
					   if (this.configs.contracts.length === 0) {
						console.log("Warning: no contract ABI loaded ...");
						return Promise.resolve([{}]);
					   }

					   console.log("parse ABI...");
      					   let reqs = this.configs.contracts.map((c) => {
      						   return this.client.call('newApp', __newAppHelper(c.ctrName)(condType));
      					   });
      					
      					   return Promise.all(reqs);
      				   })
		}

		// Ethereum (geth) related functions
                this.call = (ctrName = this.appName) => (callName) => (...args) =>
                {
                        return this.client.call('call', {appName: this.appName, ctrName, callName, args})
                }

	        this.linkAccount = (address) =>
                {
                        return this.client.call('canUseAccount', [address])
                                   .then((rc) => {
                                        if (rc.result[address] === true) {
                                                 this.userWallet = address;
                                                 return {result: true};
                                        } else {
                                                 return {result: false};
                                        }
                                   });
                }

                this.sendTk = (ctrName) => (callName) => (...__args) => (amount = null) =>
                {
                        let tkObj = {};
                        __args.map((i,j) => { tkObj = { ...tkObj, ['arg'+j]: i } });
                        let args = Object.keys(tkObj).sort();

                        return this.client.call('getTkObj', [this.appName, ctrName, callName, args, this.userWallet, amount, tkObj])
                                   .then((rc) => { let jobObj = rc.result; return this.client.call('processJobs', [jobObj]); });
                }

		this.sendTx = (tokenSymbol) => (toAddress, amount) =>
		{
			return this.client.call('getTxObj', [this.userWallet, toAddress, amount])
				   .then((rc) => { let jobObj = rc.result; return this.client.call('processJobs', [jobObj]); })
		}

		this.getTkObj = (ctrName) => (callName) => (...__args) => (amount = null) =>
		{
                        let tkObj = {};
                        __args.map((i,j) => { tkObj = { ...tkObj, ['arg'+j]: i } });
                        let args = Object.keys(tkObj).sort();

                        return this.client.call('getTkObj', [this.appName, ctrName, callName, args, this.userWallet, amount, tkObj]);
		}

		this.processJobs = (jobObjList) =>
		{
			return this.client.call('processJobs', jobObjList);
		}

		this.getReceipts = (queueID) =>
		{
			return this.client.call('getReceipts', [queueID]);
		}

		this.allAccounts = () =>
                {
                        return this.client.call('accounts', [])
                                   .then((rc) => { return rc.result });
                }

		/* 
 		 * IPFS-related calls, wrapped from the low-level jsonrpc calls
 		 * 
 		 * Note: multi-ipfs-keys support will be added soon. 
 		 *
 		 */
		this.ipfsId = () => 
		{
			return this.client.call('ipfs_myid', [])
				   .then((rc) => { return rc.result });
		}

		this.ipfsPut = (filepath) => 
		{
			return this.client.call('ipfs_put', [filepath])
				   .then((rc) => { return rc.result });
		}

		this.ipfsRead = (ipfsHash) =>
		{
			return this.client.call('ipfs_read', [ipfsHash])
				   .then((rc) => { return Buffer.from(rc.result).toString() });
		}

		this.ipnsPublish = (ipfsHash) =>
		{
			// rpc call 'ipfs_publish' *actually* supports multiple ipfs keys
			// but BladeIron still needs some ipfskey management functions 
			// before exposing it.
			return this.client.call('ipfs_publish', [ipfsHash])
				   .then((rc) => { return rc.result });
		}

		this.pullIPNS = (ipnsHash) =>
		{
			return this.client.call('ipfs_pullIPNS', [ipnsHash])
				   .then((rc) => { return rc.result });
		}
	}
}

module.exports = BladeAPI;
