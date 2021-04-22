'use strict';
const memjs = require('memjs');

const getMemcachedURL = () => process.env.memcachedUrl;

module.exports.handler = async(event) => {
    const client = memjs.Client.create(getMemcachedURL());
    await client.set('key', 'value');
    const response = await client.get('key');
    console.log('response', response.value.toString());
    client.quit();
};