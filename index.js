'use strict';

const fs = require('fs');
const path = require('path');
const rpc = require('rpc-websockets').Client;
const web3 = require('web3');
const abi = require('web3-eth-abi');
const w = new web3(); // for util functions only... :P
const ethUtils = require('ethereumjs-utils');
const MerkleTree = require('merkle_tree');

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
		this.ctrAddrBook = {};

		this.ipfs_pubsub_topicList = [];
		this.ipfs_pubsub_handlers  = {};

		// Utilities
		this.abi = abi;
		this.toAscii = (input) => { return w.toAscii(input) }
		this.toHex   = (input) => { return w.toHex(input) }
		this.toBigNumber = (input) => { return w.toBigNumber(input) }
		this.toDecimal = (input) => { return w.toDecimal(input) }
		this.toWei = (input, unit = 'ether') => { return w.toWei(input, unit) }
		this.fromWei = (input, unit = 'ether') => { return w.fromWei(input, unit) }
		this.isAddress = address => { return w.isAddress(address); }
		this.toChecksumAddress = address => { return w.toChecksumAddress(address); }

		// encode if packet is object, decode if it is RLPx
		this.handleRLPx = (fields) => (packet) => 
		{ 
			let m = {};
			try { 
				ethUtils.defineProperties(m, fields, packet);
				return m;
			} catch(err) {
				console.trace(err);
				return {};
			}
		}

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
					if (this.client.ready) return resolve(true);
					this.client.on('open', () => { resolve(true) });
				}

				return new Promise(__ready);
			} catch (err) {
				console.log(err);
				return Promise.reject(false);
			}
		}

		this.tokenWatcher = () => { return true }; // synctokens event handling placehoder

		// Only used when connecting to same contract with dynamic address
		this.connectABI = (ctrName, ctrAddr, suffix = '', condType = "Sanity") => 
		{
			if (suffix === '') suffix = ethUtils.bufferToHex(ethUtils.sha256(String(Math.random()) + 'Optract'));

			const __getABI = (ctrName, suffix) =>
			{
				return [this.appName, this.configs.version, ctrName + '_' + suffix, path.join(this.configs.artifactDir, ctrName + '.json')]
			}

			const __newAppHelper = (ctrName, suffix, ctrAddr) => (condType) =>
			{
				let output = __getABI(ctrName, suffix); let condition = {};
				this.ctrAddrBook[ctrName + '_' + suffix] = ctrAddr;
				let _c = this.configs.contracts.filter( (c) => { return (c.ctrName === ctrName && c.conditions.indexOf(condType) !== -1) });
				if (_c.length === 1) {
					condition = { [condType]: path.join(this.configs.conditionDir, this.appName, ctrName, condType + '.js') }; 
				}

				return [...output, condition, ctrAddr];
			}

      			return this.client.call('newApp', __newAppHelper(ctrName, suffix, ctrAddr)(condType))
				   .then(() => { 
					 return {[ctrName + '_' + suffix]: ctrAddr}
				   })
				   .catch((err) => { console.trace(err); })
		}

		this.init = (condType = "Sanity") => 
		{
			const __getABI = (ctrName = this.appName) =>
			{
				return [this.appName, this.configs.version, ctrName, path.join(this.configs.artifactDir, ctrName + '.json')]
			}

			const __newAppHelper = (ctrName = this.appName) => (condType) =>
			{
				let output = __getABI(ctrName); let condition = {};
				this.ctrAddrBook[ctrName] = require(output[3]).networks[this.networkID].address;
				let _c = this.configs.contracts.filter( (c) => { return (c.ctrName === ctrName && c.conditions.indexOf(condType) !== -1) });
				if (_c.length === 1) {
					condition = { [condType]: path.join(this.configs.conditionDir, this.appName, ctrName, condType + '.js') }; 
				}

				return [...output, condition];
			}

			return this.client.call('full_checks', [])
      				   .then((rc) => {
      				   	   if (!rc.geth || !rc.ipfs) {
						console.log(rc);
						throw "Server not fully functioning";
					   }
      				   })
      				   .then(() => {
					   if ( typeof(this.configs.enableGlobalTokenGroup) !== 'undefined' 
					     && this.configs.enableGlobalTokenGroup === true
			 		   ) {
					        this.client.subscribe('synctokens');
						this.client.on('synctokens', this.tokenWatcher);
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
                        return this.client.call('call', {appName: this.appName, ctrName, callName, fromAddr: this.userWallet, args})
                }

	        this.linkAccount = (address) =>
                {
                        return this.client.call('canUseAccount', [address])
                                   .then((rc) => {
                                        if (rc[address] === true) {
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
                                   .then((rc) => { let jobObj = rc; return this.client.call('processJobs', [jobObj]); });
                }

		this.sendTx = (tokenSymbol) => (toAddress, amount) =>
		{
			return this.client.call('getTxObj', [tokenSymbol, this.userWallet, toAddress, amount])
				   .then((rc) => { let jobObj = rc; return this.client.call('processJobs', [jobObj]); })
		}

		this.manualGasAmount = (gasAmount) =>
		{
			this.gasAmount = gasAmount;
			return true;
		}

		this.getTkObj = (ctrName) => (callName) => (...__args) => (amount = null) =>
		{
                        let tkObj = {};
                        __args.map((i,j) => { tkObj = { ...tkObj, ['arg'+j]: i } });
                        let args = Object.keys(tkObj).sort();

			let gasAmount = (typeof(this.gasAmount) !== 'undefined') ? this.gasAmount : undefined;

                        return this.client.call('getTkObj', [this.appName, ctrName, callName, args, this.userWallet, amount, tkObj, gasAmount]);
		}

		this.processJobs = (jobObjList) =>
		{
			this.gasAmount = undefined;
			return this.client.call('processJobs', jobObjList);
		}

		this.getReceipts = (queueID) =>
		{
			return this.client.call('getReceipts', [queueID]);
		}

		this.allAccounts = () =>
                {
                        return this.client.call('accounts', [])
                                   .then((rc) => { return rc });
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
				   .then((rc) => { return rc });
		}

		this.ipfsPut = (filepath) => 
		{
			return this.client.call('ipfs_put', [filepath])
				   .then((rc) => { return rc });
		}

		this.ipfsRead = (ipfsHash) =>
		{
			return this.client.call('ipfs_read', [ipfsHash])
				   .then((rc) => { return Buffer.from(rc).toString() });
		}

		this.ipnsPublish = (ipfsHash) =>
		{
			// rpc call 'ipfs_publish' *actually* supports multiple ipfs keys
			// but BladeIron still needs some ipfskey management functions 
			// before exposing it.
			return this.client.call('ipfs_publish', [ipfsHash])
				   .then((rc) => { return rc });
		}

		this.pullIPNS = (ipnsHash) =>
		{
			return this.client.call('ipfs_pullIPNS', [ipnsHash])
				   .then((rc) => { return rc });
		}

		this.ipfs_pubsub_publish = (topic, buffer) =>
		{
			return this.client.call('ipfs_pubsub_publish', [topic, buffer])
				   .then((rc) => { return rc });
		}

		this.ipfs_pubsub_subscribe = (topic) => (handler = undefined) =>
		{
			if (this.ipfs_pubsub_topicList.indexOf(topic) !== -1) {
				console.log(`Already subscribed to topic ${topic}`);
				return true;
			}

			this.ipfs_pubsub_handlers[topic] = handler;

			return this.client.call('ipfs_pubsub_subscribe', [topic]).then((rc) => { 
					if (!rc) return false;
					this.ipfs_pubsub_topicList.push(topic);

					if (this.ipfs_pubsub_topicList.length === 1) {
						this.client.subscribe('ipfs_pubsub_incomming');
						this.client.on('ipfs_pubsub_incomming', this.ipfs_pubsub_dispatcher);
					}

					return rc;
			})
			.catch((err) => { console.trace(err); });
		}

		this.ipfs_pubsub_update_handler = (topic) => (handler = undefined) =>
		{
			if (this.ipfs_pubsub_topicList.indexOf(topic) === -1) {
				console.log(`Warning: Not currently subscribed to topic ${topic}`);
			}

			this.ipfs_pubsub_handlers[topic] = handler;
			return true;	
		}

		this.ipfs_pubsub_unsubscribe = (topic) =>
		{
			if (this.ipfs_pubsub_topicList.indexOf(topic) === -1) {
				console.log(`Not currently subscribed to topic ${topic}`);
				return true;
			}

			return this.client.call('ipfs_pubsub_unsubscribe', [topic]).then((rc) => {
				if (!rc) return false;
				delete(this.ipfs_pubsub_handlers[topic]);
				this.ipfs_pubsub_topicList = this.ipfs_pubsub_topicList.filter((t) => { return t !== topic });
				if (this.ipfs_pubsub_topicList.length === 0) {
					this.client.unsubscribe('ipfs_pubsub_incomming');
					this.client.off('ipfs_pubsub_incomming');
				}
				return true;
			});
		}

		// msgObj comes from server 'ipfs_pubsub_incomming' event 
		this.ipfs_pubsub_dispatcher = (msgObj) => 
		{
			if (this.ipfs_pubsub_topicList.indexOf(msgObj.topic) === -1) return;
			// for quick test, use unified topic handler here
			if (typeof(this.ipfs_pubsub_handlers[msgObj.topic]) === 'undefined') {
				console.dir(msgObj);
				console.log(`This is simple default topic handler, please supplies your own for topic: ${msgObj.topic}`)
			} else if (typeof(this.ipfs_pubsub_handlers[msgObj.topic]) === 'function') {
				return this.ipfs_pubsub_handlers[msgObj.topic](msgObj);
			}

		}

                this.verifySignature = (sigObj) => //sigObj = {payload, v,r,s, networkID}
                {
                        let signer = '0x' +
                              ethUtils.bufferToHex(
                                ethUtils.sha3(
                                  ethUtils.bufferToHex(
                                        ethUtils.ecrecover(sigObj.payload, sigObj.v, sigObj.r, sigObj.s, sigObj.netID)
                                  )
                                )
                              ).slice(26);

                        console.log(`signer address: ${signer}`);

                        return signer === ethUtils.bufferToHex(sigObj.originAddress);
                }

                this.makeMerkleTree = (leaves) => {
                        let merkleTree = new MerkleTree();
                        merkleTree.addLeaves(leaves);
                        merkleTree.makeTree();
                        return merkleTree;
                }

                this.getMerkleProof = (leaves, targetLeaf) => {
                        let merkleTree = new MerkleTree();
                        merkleTree.addLeaves(leaves);
                        merkleTree.makeTree();

                        let __leafBuffer = Buffer.from(targetLeaf.slice(2), 'hex');
                        let txIdx = merkleTree.tree.leaves.findIndex( (x) => { return Buffer.compare(x, __leafBuffer) == 0 } );
                        if (txIdx == -1) {
                                console.log('Cannot find leave in tree!');
                                return false;
                        } else {
                                console.log(`Found leave in tree! Index: ${txIdx}`);
                        }

                        let proofArr = merkleTree.getProof(txIdx, true);
                        let proof = proofArr[1].map((x) => {return ethUtils.bufferToHex(x);});
                        let isLeft = proofArr[0];

                        //targetLeaf = ethUtils.bufferToHex(merkleTree.getLeaf(txIdx));
                        let merkleRoot = ethUtils.bufferToHex(merkleTree.getMerkleRoot());
                        return [proof, isLeft, merkleRoot];
                }
	}
}

module.exports = BladeAPI;
