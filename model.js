(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SurveyInput=factory();})(globalThis,function(){
'use strict';
const states={answered:'answered',missing:'missing',not_asked:'not_asked','回答済み':'answered','欠測':'missing','未質問':'not_asked'};
function fail(s){throw Error(s);}
function request(v){
 if(!['single','multiple'].includes(v.type))fail('単一回答か複数回答を選んでください。');
 if(!['answered','eligible','total'].includes(v.policy))fail('宣言した分母方針を選んでください。未記載の方針は推測できません。');
 const choices=v.choices.replace(/\r\n?/g,'\n').split('\n');
 if(choices.length<1||choices.length>50||choices.some(x=>!x||x!==x.trim()||/[\t|]/.test(x))||new Set(choices).size!==choices.length)fail('選択肢は1行に1つ、前後空白・空行・重複・タブ・縦棒なしで50個まで入力してください。');
 const lines=v.rows.replace(/\r\n?/g,'\n').replace(/\n$/,'').split('\n');
 if(lines.shift()!=='row_id\tstate\tselected')fail('先頭行は row_id、state、selected の3列をタブで区切ってください。CSVや引用符付きの表は対象外です。');
 if(!lines.length||lines.length>1000)fail('回答行は1〜1000行で入力してください。空行は削除し、欠測は状態として記載してください。');
 const responses=lines.map((line,i)=>{
  const c=line.split('\t');if(c.length!==3||c.some(x=>x.includes('"')))fail('回答表の'+(i+2)+'行目：タブ区切り3列が必要です。引用符付きセルは扱いません。');
  if(!c[0]||c[0]!==c[0].trim()||c[0].length>80)fail('回答表の'+(i+2)+'行目：匿名行IDは空欄・前後空白なしの80文字以内にしてください。');
  if(!Object.prototype.hasOwnProperty.call(states,c[1]))fail('回答表の'+(i+2)+'行目：状態は answered／missing／not_asked（回答済み／欠測／未質問）を明記してください。');
  return {row_id:c[0],state:states[c[1]],selected:c[2]===''?[]:c[2].split('|')};
 });
 if(!choices.includes(v.choice))fail('割合を確認する選択肢を、上の選択肢と同じ文字で入力してください。');
 const reports=['A','B'].map(id=>{
  const kind=v['kind'+id];if(!['answered','eligible','total','selections'].includes(kind))fail('出力'+id+'の分母定義を選んでください。');
  const raw=v['pct'+id];if(raw.trim()===''||!/^\d+(\.\d+)?$/.test(raw))fail('出力'+id+'の割合を数値で明記してください。空欄は0にしません。');
  const n=Number(raw);if(!Number.isFinite(n)||n<0||n>100)fail('出力'+id+'の割合は0〜100%の範囲にしてください。');
  return {id,choice:v.choice,denominator_kind:kind,value_pct:n};
 });
 return {tool:'survey_denominator_audit',arguments:{questions:[{id:'q1',type:v.type,choices,denominator_policy:v.policy,responses,reports}]}};
}
function sample(multiple){return multiple?{type:'multiple',policy:'answered',choices:'A\nB',choice:'A',rows:'row_id\tstate\tselected\nr1\tanswered\tA|B\nr2\tanswered\tA\nr3\tanswered\tB',kindA:'answered',pctA:'66.67',kindB:'selections',pctB:'50'}:{type:'single',policy:'answered',choices:'はい\nいいえ',choice:'はい',rows:'row_id\tstate\tselected\nr1\tanswered\tはい\nr2\tanswered\tはい\nr3\tanswered\tはい\nr4\tanswered\tはい\nr5\tanswered\tはい\nr6\tanswered\tはい\nr7\tanswered\tいいえ\nr8\tanswered\tいいえ\nr9\tmissing\t\nr10\tmissing\t',kindA:'answered',pctA:'75',kindB:'total',pctB:'60'};}
return Object.freeze({request,sample});});
