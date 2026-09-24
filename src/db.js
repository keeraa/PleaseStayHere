import { createClient } from '@supabase/supabase-js';
import { contentFingerprint, duplicateScore } from './dedupe.js';

const url=process.env.SUPABASE_URL;
const key=process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY');

const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});

function fail(error, context){
  if (error) throw new Error(`${context}: ${error.message}`);
}
function jsonValue(v,fallback){
  if (Array.isArray(v) || (v && typeof v==='object')) return v;
  try { return JSON.parse(v ?? JSON.stringify(fallback)); } catch { return fallback; }
}

export async function upsertSource(source){
  const {error}=await supabase.from('sources').upsert({
    id:source.id,type:source.type,name:source.name||source.id,url:source.url,
    country:source.country||null,city:source.city||null
  },{onConflict:'id'});
  fail(error,'upsert source');
}
export async function touchSource(id){
  const {error}=await supabase.from('sources').update({last_collected_at:new Date().toISOString()}).eq('id',id);
  fail(error,'touch source');
}
export async function insertRawPost(post){
  const payload={...post,images_json:jsonValue(post.images_json,[]),raw_json:jsonValue(post.raw_json,{})};
  const {data,error}=await supabase.from('raw_posts').insert(payload).select('id').maybeSingle();
  if (error?.code==='23505') return null;
  fail(error,'insert raw post');
  return data?.id ?? null;
}
async function recentCandidates(x){
  let q=supabase.from('listings')
    .select('id,source_url,contact_phone,price,currency,area,property_type,bedrooms,description,content_fingerprint')
    .is('duplicate_of_listing_id',null)
    .order('id',{ascending:false})
    .limit(1200);
  q=x.city ? q.eq('city',x.city) : q.is('city',null);
  const {data,error}=await q;
  fail(error,'load dedupe candidates');
  return data||[];
}
export async function insertListing(x){
  x.content_fingerprint=contentFingerprint(x.description||'');
  let best=null;
  for (const c of await recentCandidates(x)){
    const d=duplicateScore(x,c);
    if (!best || d.score>best.score) best={...d,id:c.id};
    if (d.score===1) break;
  }
  if (best && best.score>=0.93){
    x.duplicate_of_listing_id=best.id;
    x.duplicate_score=best.score;
    x.duplicate_reason=best.reason;
  } else {
    x.duplicate_of_listing_id=null;
    x.duplicate_score=best?.score ?? null;
    x.duplicate_reason=null;
  }
  const payload={...x,images_json:jsonValue(x.images_json,[])};
  const {data,error}=await supabase.from('listings').insert(payload).select('id').maybeSingle();
  if (error?.code==='23505') return null;
  fail(error,'insert listing');
  return data?.id ?? null;
}
async function exactCount(table, apply){
  let q=supabase.from(table).select('*',{count:'exact',head:true});
  if (apply) q=apply(q);
  const {count,error}=await q;
  fail(error,`count ${table}`);
  return count||0;
}
export async function stats(){
  const [sources,rawPosts,listings,uniqueListings]=await Promise.all([
    exactCount('sources'),
    exactCount('raw_posts'),
    exactCount('listings'),
    exactCount('listings',q=>q.is('duplicate_of_listing_id',null))
  ]);
  return {sources,rawPosts,listings,uniqueListings,duplicatesHidden:listings-uniqueListings};
}
export async function listListings(filters={}){
  let q=supabase.from('listings').select(`
    *,
    raw_posts!inner(
      author,
      collected_at,
      sources!inner(name)
    )
  `).order('id',{ascending:false}).limit(1000);
  if (!filters.includeDuplicates) q=q.is('duplicate_of_listing_id',null);
  if (filters.city) q=q.eq('city',filters.city);
  if (filters.area) q=q.eq('area',filters.area);
  if (filters.type) q=q.eq('property_type',filters.type);
  if (filters.currency) q=q.eq('currency',filters.currency);
  if (filters.minPrice) q=q.gte('price',Number(filters.minPrice));
  if (filters.maxPrice) q=q.lte('price',Number(filters.maxPrice));
  if (filters.q){
    const s=String(filters.q).replace(/[,%()]/g,' ').trim();
    if (s) q=q.or(`title.ilike.%${s}%,description.ilike.%${s}%,area.ilike.%${s}%`);
  }
  const {data,error}=await q;
  fail(error,'list listings');
  return (data||[]).map(x=>({
    ...x,
    images:Array.isArray(x.images_json)?x.images_json:[],
    author:x.raw_posts?.author||null,
    collected_at:x.raw_posts?.collected_at||null,
    source_name:x.raw_posts?.sources?.name||null
  }));
}
export async function facets(){
  const {data,error}=await supabase.from('listings')
    .select('city,area,property_type')
    .is('duplicate_of_listing_id',null)
    .limit(10000);
  fail(error,'load facets');
  const group=k=>{
    const m=new Map();
    for (const row of data||[]) if (row[k]) m.set(row[k],(m.get(row[k])||0)+1);
    return [...m].map(([value,count])=>({value,count})).sort((a,b)=>b.count-a.count);
  };
  return {cities:group('city'),areas:group('area'),types:group('property_type')};
}
