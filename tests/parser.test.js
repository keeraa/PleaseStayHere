import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeRental, parseListing } from '../src/parser.js';

const source={country:'Indonesia',city:'Bali'};

test('detects a Bali monthly rental',()=>{
  const raw={id:1,text:'AVAILABLE NOW - 2BR villa in Ubud. Rp 12 juta per month. WhatsApp +62 812 3456 7890',source_url:'x',images_json:'[]'};
  const x=parseListing(raw,source);
  assert.equal(x.property_type,'villa');
  assert.equal(x.bedrooms,2);
  assert.equal(x.area,'Ubud');
  assert.equal(x.price,12000000);
  assert.equal(x.currency,'IDR');
  assert.equal(x.price_period,'month');
  assert.equal(x.available_from,'now');
});

test('rejects unrelated sale',()=>{
  assert.equal(looksLikeRental('Motorbike for sale, good condition, 18 juta'),false);
});
