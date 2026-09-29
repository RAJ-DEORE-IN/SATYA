const timesOfIndia = require('./timesOfIndia');
const ndtv = require('./ndtv');
const bbcIndia = require('./bbcIndia');
const hindu = require('./hindu');
const indianExpress = require('./indianExpress');
const livemint = require('./livemint');
const boomFactCheck = require('./boomFactCheck');
const wikipedia = require('./wikipedia');
const socialTrends = require('./socialTrends');

const newsSources = [
    timesOfIndia,
    ndtv,
    bbcIndia,
    hindu,
    indianExpress,
    livemint,
    boomFactCheck
];

module.exports = {
    newsSources,
    wikipedia,
    socialTrends
};