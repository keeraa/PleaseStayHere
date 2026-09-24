import fs from 'node:fs';
import crypto from 'node:crypto';
import { loadSources } from './config.js';
import { upsertSource, touchSource, insertRawPost, insertListing, stats } from './db.js';
import { parseListing } from './parser.js';

const [cmd,arg]=process.argv.slice(2);
const now=()=>new Date().toISOString();

async function persist(source,posts){
  await upsertSource(source);
  let added=0,listings=0;
  for (const p of posts){
    const raw={
      source_id:source.id,
      source_post_key:p.source_post_key||crypto.createHash('sha1').update((p.text||'')+'|'+(p.source_url||'')).digest('hex'),
      source_url:p.source_url||null,
      author:p.author||null,
      text:p.text||'',
      images_json:p.images||[],
      published_label:p.published_label||null,
      collected_at:now(),
      raw_json:p
    };
    const id=await insertRawPost(raw);
    if (!id) continue;
    added++;
    const listing=parseListing({...raw,id,images_json:JSON.stringify(raw.images_json)},source);
    if (listing){
      await insertListing({...listing,images_json:raw.images_json});
      listings++;
    }
  }
  await touchSource(source.id);
  return {added,listings};
}

if (cmd==='collect'){
  const maxScrollsArg=process.argv.find(x=>x.startsWith('--scrolls='));
  const maxScrolls=maxScrollsArg?Number(maxScrollsArg.split('=')[1]):12;
  const wanted=process.argv.find(x=>x.startsWith('--source='))?.split('=')[1];
  const sources=loadSources().filter(s=>!wanted||s.id===wanted);
  if (!sources.length) throw new Error('No enabled sources. Edit config/sources.json');

  for (const source of sources){
    if (source.type!=='facebook_group') continue;
    console.log(`Collecting ${source.id}: ${source.url}`);
    try{
      const {collectFacebookGroup}=await import('./facebook/collector.js');
      const posts=await collectFacebookGroup(source,{maxScrolls});
      const r=await persist(source,posts);
      console.log(`  seen=${posts.length} new=${r.added} rental_listings=${r.listings}`);
    }catch(error){
      console.error(`  skipped: ${error.message}`);
    }
  }
  console.log(await stats());
}else if(cmd==='import-fixture'){
  if(!arg) throw new Error('Fixture path required');
  const doc=JSON.parse(fs.readFileSync(arg,'utf8'));
  console.log(await persist(doc.source,doc.posts));
  console.log(await stats());
}else if(cmd==='stats'){
  console.log(JSON.stringify(await stats(),null,2));
}else{
  console.log('Commands: collect | import-fixture <file> | stats');
}
