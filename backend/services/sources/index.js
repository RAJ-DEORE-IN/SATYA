const timesOfIndia = require('./timesOfIndia');
const ndtv = require('./ndtv');
const bbcIndia = require('./bbcIndia');
const hindu = require('./hindu');
const hindustanTimes = require('./hindustanTimes');
const livemint = require('./livemint');
const boomFactCheck = require('./boomFactCheck');
const factly = require('./factly');
const wikipedia = require('./wikipedia');
const socialTrends = require('./socialTrends');

const newsSources = [
    timesOfIndia,
    ndtv,
    bbcIndia,
    hindu,
    hindustanTimes,
    livemint,
    boomFactCheck,
    factly
];

module.exports = {
    newsSources,
    wikipedia,
    socialTrends
};
