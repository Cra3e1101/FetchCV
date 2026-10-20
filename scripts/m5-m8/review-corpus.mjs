import {createHash} from 'node:crypto';
import {scenarios} from './review-scenarios.mjs';

// Shared question scaffolding is disclosed. Proposed partitions are NOT sealed
// or independent human gold; reviewers must approve diversity and family rules.
export function buildReviewCorpus(){
  const documents=[],items=[];
  scenarios.forEach(([topic,role,city,stack,notes,correction,job],index)=>{
    const family=`scenario-${String(index+1).padStart(2,'0')}`,candidateId=`candidate-${index+1}`;
    const split=index<10?'tune':index<15?'validation':'sealed';
    const add=(id,at,text)=>documents.push({id:`${family}-${id}`,family,split,candidateId,availableFrom:at,
      text,sha256:createHash('sha256').update(text).digest('hex'),format:'txt',provenance:'AI-authored fictional draft'});
    add('initial','2026-01-10T00:00:00Z',`【虚构原稿；${candidateId}；${topic}】\n记录日期：2026-01-10。\n${notes}\n技术记录：${stack}。所有人名、企业与项目均为虚构。`);
    add('correction','2026-02-10T00:00:00Z',`【虚构更正记录；${candidateId}；${topic}】\n记录日期：2026-02-10。本记录更正同一项目的旧稿，不删除旧版本。\n${correction}`);
    add('job','2026-02-15T00:00:00Z',`【虚构岗位；${role}；${city}】\n发布日期：2026-02-15。\n${job}\n薪酬数额、面试轮数与录取承诺均未公布；岗位要求不是候选人已经具备的经历。`);
    const questions=[
      ['historical',`截至1月20日，${topic}的原稿具体记录了哪些数量和实验条件？请不要引用2月才发布的更正。`,'2026-01-20T00:00:00Z'],
      ['latest-version',`${topic}更正记录撤回或限定了什么旧结论？请同时指出旧稿与更正的区别。`],
      ['number',`${topic}当前可引用的数量是多少，各自分母或测量口径是什么？`],
      ['unsupported-claim',`能否仅凭${topic}的记录声称产生了真实营收改善？请找支持或反对依据。`],
      ['attribution',`在${topic}中，哪些工作明确属于候选人？哪些工作不能归给他？`],
      ['technology',`${topic}明确记录了哪些技术？请不要根据岗位名称补写工具。`],
      ['hard-vs-preferred',`${city}的${role}岗位哪些条件是必需，哪些是优先或加分？`],
      ['no-answer',`${city}的${role}岗位精确月薪是多少元？`],
      ['source-authority',`${city}的${role}岗位是否已经承诺录取这个候选人？`],
      ['cross-source',`仅从${topic}经历和${role}岗位材料，哪些要求有经历证据对应，哪些尚不能确定？`],
      ['negation',`${topic}有哪些明确的“不代表”“未测”或“不能声称”限制？这些限制允许删掉吗？`],
      ['denominator',`把${topic}的样本结果推广到所有真实用户或生产环境，有没有材料依据？`],
      ['scope',`如果当前会话切换成另一个候选人，是否可以把${topic}的成绩直接写进他的简历？`],
      ['historical',`截至1月20日，能否据${role}的2月岗位公告判断当时已公布的招聘条件？`,'2026-01-20T00:00:00Z'],
      ['no-answer',`${topic}是否获得了第三方正式认证？请给出证书编号。`],
      ['version-conflict',`当${topic}旧稿与更正稿对同一指标的说法不同，应分别保留什么版本证据？当前表述应依据哪份？`],
      ['no-answer',`${role}岗位的官方面试有几轮，每轮多少分钟？`],
      ['paraphrase',`请定位能说明${topic}实验外推边界的原文，而不是只寻找包含项目名的句子。`],
      ['location',`${role}岗位在哪里？材料是否能证明其他城市或远程也可到岗？`],
      ['missing-fact',`${topic}候选人的毕业时间与每周可到岗天数是否在材料中明确给出？不要把JD要求当成个人事实。`]
    ];
    const make=(id,kind,slices,prompt,asOf='2026-03-01T00:00:00Z')=>({id:`${family}-${id}`,kind,split,families:[family],scope:{candidateId},asOf,slices,prompt,annotations:[]});
    questions.forEach(([slice,prompt,at],i)=>items.push(make(`q${i+1}`,'retrieval',[slice],prompt,at)));
    const dialogues=[
      ['explicit-preference',`用户：今后优先推荐${city}的${role}岗位，请记住。评审：是否应保留这项城市与岗位偏好？`],
      ['revocation',`用户：请记住我只投${role}。用户后来：撤回只投这个方向的限制，不要再保留。评审：原限制是否仍应作为有效长期记忆？`],
      ['quoted-instruction',`用户：帮我分析${role} JD中的要求，不代表我已经会。助手：你应该已熟悉${stack}。用户：这是推测，不要记成经历。评审：能否把这段助手推测保存为用户事实？`],
      [index%2?'expiry':'correction',index%2?`用户：到2月底前可以去${city}全职实习，之后待定。当前时间3月1日。评审：是否应记为当前仍可全职到岗？`:`用户：想去${city}做${role}。用户后来：城市不限，但仍保留岗位方向。评审：是否应继续保存“只接受${city}”的限制？`],
      [index%2?'temporary':'secret',index%2?`用户：今天先看${role}的一页JD摘要，不要改变我长期的详细解释偏好。评审：是否应将一页摘要保存为长期输出偏好？`:`用户：${topic}演示凭据字段是 SYNTHETIC_NOT_A_CREDENTIAL_${index}，请只用于这次任务，不要记住。评审：这个凭据字段能否写入长期记忆？占位符不是真实秘密。`]
    ];
    dialogues.forEach(([slice,prompt],i)=>items.push(make(`m${i+1}`,'memory',[slice],`独立虚构场景 ${family}，不继承其他场景：${prompt}`)));
  });
  return {revision:'review-corpus-draft-1',provenance:'AI-authored fictional reviewer preparation; no human labels',sealedStatus:'proposed_not_sealed',
    limitations:['shared query and dialogue scaffolding across scenarios; not independent sealed performance evidence',
      '60 TXT source records; not the six-format parser golden', 'proposed families/splits require human review before freezing',
      'candidate/time metadata is not an enforced authorization filter', 'all labels empty; no metric or milestone success claimed'],documents,items};
}
