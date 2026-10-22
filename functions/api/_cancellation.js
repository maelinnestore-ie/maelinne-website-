export const cancellationReady=env=>!!(env.DB&&env.RESEND_API_KEY&&env.CANCELLATION_FROM);
export const cancellationReply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
export const cancellationSchema=`CREATE TABLE IF NOT EXISTS cancellation_notices (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, order_reference TEXT NOT NULL, email TEXT NOT NULL,
 items TEXT NOT NULL, received_at TEXT NOT NULL, ip_hash TEXT NOT NULL DEFAULT '',
 customer_email_sent INTEGER NOT NULL DEFAULT 0, merchant_email_sent INTEGER NOT NULL DEFAULT 0
)`;
export function cancellationData(body){
 const text=(value,max)=>typeof value==='string'&&value.trim().length<=max&&!/[\u0000-\u001f\u007f]/.test(value.trim())?value.trim():null;
 const id=body?.id,name=text(body?.name,120),order_reference=text(body?.order_reference,160),email=text(body?.email,254),items=text(typeof body?.items==='string'?body.items.replace(/[\r\n\t]+/g,' '):body?.items,1000);
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id||'')||!name||!order_reference||!email||! /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)||items===null)throw Error('Enter your name, order reference, a valid email and up to 1,000 characters for the items.');
 return {id,name,order_reference,email,items:items||'Entire order'};
}
export function cancellationReceipt(row){return `MaeLinne — cancellation received\n\nCancellation reference: ${row.id}\nReceived (UTC): ${row.received_at}\nName: ${row.name}\nOrder reference: ${row.order_reference}\nEmail: ${row.email}\nItems: ${row.items}\n\nStatement: I give notice that I cancel the purchase of the items listed above.\n\nWe have received your cancellation notice. This acknowledgement is not a refund confirmation. You do not need our approval to exercise your statutory cancellation right.\n\nIf you already have the items, send them back without undue delay and within 14 days of notifying us. Returns: Maelinne Store, Ballynacourty, Belgooly, P17 YD88, Ireland. You pay change-of-mind return postage; we cover necessary return costs for faulty, incorrect or misdescribed goods. If your order has not arrived, contact us before sending anything.\n\nRefunds follow our Terms & Returns: https://www.maelinne.ie/terms.html\nQuestions: maelinnestore@gmail.com\n`;}
async function email(env,id,to,subject,text){
 const r=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({from:env.CANCELLATION_FROM,to:[to],reply_to:'maelinnestore@gmail.com',subject,text})});
 if(!r.ok)throw Error('Email service unavailable');
 const result=await r.json();if(!result.id)throw Error('Email service unavailable');
}
export async function sendCancellationEmails(env,db,row){
 const text=cancellationReceipt(row);
 if(!row.customer_email_sent){try{await email(env,'cancellation-customer-'+row.id,row.email,'MaeLinne — cancellation received',text);await db.prepare('UPDATE cancellation_notices SET customer_email_sent=1 WHERE id=?').bind(row.id).run();row.customer_email_sent=1;}catch{/* Notice stays saved; the dashboard shows delivery needing attention. */}}
 if(!row.merchant_email_sent){try{await email(env,'cancellation-merchant-'+row.id,'maelinnestore@gmail.com','MaeLinne — cancellation notice received',text);await db.prepare('UPDATE cancellation_notices SET merchant_email_sent=1 WHERE id=?').bind(row.id).run();row.merchant_email_sent=1;}catch{/* Retain for dashboard retry. */}}
 return row;
}
export const onRequest=()=>cancellationReply({error:'Not found.'},404);
