import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateScore, contentFingerprint } from '../src/dedupe.js';

const base={
  source_url:'https://www.facebook.com/groups/x/posts/123?__cft__=abc',
  contact_phone:'+6281234567890', price:12000000, currency:'IDR', area:'Ubud', property_type:'villa', bedrooms:2,
  description:'AVAILABLE NOW. Beautiful 2BR villa in Ubud, private pool, wifi. Rp 12 juta per month. WhatsApp +62 812 3456 7890'
};

test('same Facebook permalink is an exact duplicate',()=>{
  const other={...base,source_url:'https://www.facebook.com/groups/x/posts/123?ref=share'};
  assert.equal(duplicateScore(base,other).reason,'same_url');
  assert.equal(duplicateScore(base,other).score,1);
});

test('reposted listing with changed wording is still a duplicate',()=>{
  const other={...base,source_url:'https://www.facebook.com/groups/other/posts/999',description:'Ubud villa available! 2 bedrooms, private pool and WiFi. 12,000,000 IDR / month. Contact WA +62 812-3456-7890'};
  const d=duplicateScore({...base,content_fingerprint:contentFingerprint(base.description)},{...other,content_fingerprint:contentFingerprint(other.description)});
  assert.ok(d.score>=0.93, JSON.stringify(d));
});

test('similar price but different property is not collapsed',()=>{
  const other={...base,source_url:'https://www.facebook.com/groups/other/posts/777',contact_phone:'+6287777777777',area:'Canggu',property_type:'apartment',bedrooms:1,description:'1BR apartment in Canggu, 12 juta monthly, near beach'};
  assert.ok(duplicateScore(base,other).score<0.93);
});
