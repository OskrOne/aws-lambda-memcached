'use strict';
const memjs = require('memjs');
const axios = require('axios').default;

const getMemcachedURL = () => process.env.memcachedUrl;
const url = 'https://dummy.restapiexample.com/api/v1/employees';
const memcachedKey = 'employees';

module.exports.handler = async(event) => {
    const client = memjs.Client.create(getMemcachedURL());

    // First, try to get the data from cache
    // Memcached is in the private subnets, the lambda can hit the URL bc it is inside the private subnets as well
    // Memcached segurity group only allows requests from private ips
    const employees = await client.get(memcachedKey);
    let response;
    if (employees.value !== null) {
        response = JSON.parse(employees.value.toString());
    } else { 
        // If the data doesn't exist, gets it from Internet
        // The lambda can hit the Internet bc there is a nat gateway that enables the connection but prevents the internet 
        // initiate connections
        const axiosResponse = await axios.get(url, {
            headers: {
                Accept: 'application/json'
            }
        });
        await client.set(memcachedKey, JSON.stringify(axiosResponse.data));
        response = axiosResponse.data;
    }
    
    client.quit();  
    return response;
};