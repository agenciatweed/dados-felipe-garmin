import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/cloud.mjs';

function response(){return {code:0,headers:{},data:null,setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(data){this.data=data;return this;},send(data){this.data=data;return this;}};}
test('catalog contains only enabled resources and cannot access Garmin',async()=>{
 const res=response();await handler({url:'/api/catalog',query:{},method:'GET',headers:{}},res);
 assert.equal(res.code,200);assert.equal(res.data.endpoints,14);
 assert.ok(!res.data.resources.some(r=>['hrv','hrv_range','weight','spo2','cycle','food','hydration'].includes(r.id)));
});
test('private ingestion requires a separate application credential',async()=>{
 const res=response();await handler({url:'/api/ingest',query:{},method:'POST',headers:{},body:Buffer.from('invalid')},res);
 assert.equal(res.code,401);
});
test('ingestion rejects path traversal before touching Blob',async()=>{
 process.env.GARMIN_SYNC_SECRET='synthetic-test-secret';
 const res=response();await handler({url:'/api/ingest',query:{},method:'POST',headers:{authorization:'Bearer synthetic-test-secret','x-garmin-object':'../../private'},body:Buffer.from('invalid')},res);
 assert.equal(res.code,400);
 delete process.env.GARMIN_SYNC_SECRET;
});
