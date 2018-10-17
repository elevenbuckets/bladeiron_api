'use strict';

// Basic Functional Stuffs
const compose  = (...fns) => args => { fns.reduce((r,f) => {return f(r)}, args); return args; };
const comprise = (...fns) => args => { return fns.reduce((r,f) => {return f(r)}, args); };
const repeats  = times => (...fns) => args => { [...Array(times)].map((i) => { return fns.reduce((r,f) => {return f(r)}, args); }); };
const rand = limit => { return Math.random() * limit; }
const randInt = limit => { return Math.floor(rand(limit)); }
const log = message => { console.log(message); }
const loopOver = list => (...fns) => { list.map((i) => { comprise(...fns)(i); }); }
const patchObj = addonObj => inputObj => { return {...addonObj, ...inputObj} }; // no overwrite

module.exports = { compose, comprise, repeats, rand, randInt, log, loopOver, patchObj };
