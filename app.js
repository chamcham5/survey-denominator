(function(){'use strict';
const $=id=>document.getElementById(id), ids=['type','policy','choices','choice','rows','kindA','pctA','kindB','pctB'];
const policies={answered:'回答済みの行',eligible:'対象行（未質問を除く）',total:'全行',selections:'全選択数'},states={answered:'回答済み',missing:'欠測',not_asked:'未質問'};
function resetResult(){$('result').hidden=true;$('cards').replaceChildren();$('row-table').replaceChildren();$('copy-result').value='';$('error').hidden=true;}
ids.forEach(id=>$(id).addEventListener('input',resetResult));
function load(m){resetResult();const s=SurveyInput.sample(m);ids.forEach(id=>$(id).value=s[id]);}
$('single-sample').addEventListener('click',()=>load(false));$('multi-sample').addEventListener('click',()=>load(true));
$('clear').addEventListener('click',()=>{ids.forEach(id=>$(id).value='');resetResult();$('type').focus();});
$('select-result').addEventListener('click',()=>{$('copy-result').focus();$('copy-result').select();});
function n(tag,text){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;}
function percent(v){return v===null?'未算出（分母0）':String(Math.round(v*10000)/10000)+'%';}
$('audit').addEventListener('submit',event=>{event.preventDefault();resetResult();try{
 const v=Object.fromEntries(ids.map(id=>[id,$(id).value]));const req=SurveyInput.request(v);const res=BusinessCore.execute(req);if(res.error)throw Error(res.error.code+'：'+res.error.message);
 const q=req.arguments.questions[0],d=res.derived.questions.q1,c=d.counts;
 $('counts').textContent='全'+c.total+'行 / 回答済み'+c.answered+' / 欠測'+c.missing+' / 未質問'+c.not_asked+' / 選択数'+c.selections+'。宣言方針：'+policies[q.denominator_policy]+'、分母'+d.denominator+'。';
 const texts=['分母と回答行の比較票（1設問）','入力した宣言方針: '+policies[q.denominator_policy],$('counts').textContent,'比較対象選択肢: '+v.choice];
 for(const id of ['A','B']){const input=q.reports.find(r=>r.id===id),out=d.reports[id],card=n('section');card.className='audit-card';
 const arithmetic=out.arithmetic_correct===null?'判定不能（分母0）':out.arithmetic_correct?'一致':'不一致';const policy=input.denominator_kind===q.denominator_policy?'一致':'方針差あり';
 const ls=['出力'+id+' / 入力値'+input.value_pct+'%','検算値 '+percent(out.expected_pct)+' / 分母 '+out.denominator+'（'+policies[input.denominator_kind]+'）','算術: '+arithmetic+'（許容差±0.01ポイント）','宣言方針との比較: '+policy,'採用・寄与する行ID: '+(out.denominator_row_ids.join(', ')||'なし')];
 card.append(n('h3','出力'+id),...ls.slice(0,4).map(t=>n('p',t)));if(input.denominator_kind==='selections')card.append(n('p','行IDは選択に寄与する回答者を示します。行数と分母は一致しない場合があります。'));
 $('cards').append(card);texts.push('',...ls);}
 const sets=Object.fromEntries(['A','B'].map(id=>[id,new Set(d.reports[id].denominator_row_ids)]));const declared=new Set(d.denominator_row_ids);const table=n('table');table.append(n('caption','入力された行と採用状態（表示は先頭200行）'));const head=n('thead'),tr=n('tr');['行ID','状態','選択肢','宣言方針','出力A','出力B'].forEach(t=>{const th=n('th',t);th.scope='col';tr.append(th);});head.append(tr);table.append(head);const body=n('tbody');
 texts.push('','宣言方針で採用する行ID: '+(d.denominator_row_ids.join(', ')||'なし'),'行ごとの採用・除外（全行）');
 q.responses.forEach((row,index)=>{const labels=['A','B'].map(id=>sets[id].has(row.row_id)?(q.reports.find(r=>r.id===id).denominator_kind==='selections'?'寄与（'+row.selected.length+'選択）':'採用'):'除外');const cols=[row.row_id,states[row.state],row.selected.join(' / ')||'回答なし',declared.has(row.row_id)?'採用':'除外',...labels];texts.push(cols.join(' | '));if(index<200){const rowEl=n('tr');cols.forEach((t,i)=>{const td=n(i===0?'th':'td',t);if(i===0)td.scope='row';rowEl.append(td);});body.append(rowEl);}});table.append(body);$('row-table').append(table);$('row-limit').textContent='表は'+Math.min(200,c.total)+' / '+c.total+'行表示。コピー用比較票は全行です。';
 texts.push('','未記載の条件・母集団・元ファイル間の対応は推測していません。統計的妥当性・匿名化・有料需要を保証しません。');$('copy-result').value=texts.join('\n');$('result').hidden=false;
 }catch(err){$('error').textContent=err.message;$('error').hidden=false;}
});})();
