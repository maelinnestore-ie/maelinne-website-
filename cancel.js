(()=>{
 const form=document.getElementById('cancel-form'),details=document.getElementById('details'),review=document.getElementById('review'),message=document.getElementById('form-error'),confirm=document.getElementById('confirm-button'),availability=document.getElementById('availability');
 let enabled=false,stage='details',pending=null,busy=false,receiptURL;
 const showError=text=>{message.textContent=text;message.hidden=false;};
 fetch('/api/cancellations',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();const config=await r.json();enabled=config.enabled===true;document.getElementById('review-button').disabled=!enabled;availability.textContent=enabled?'Your cancellation will be recorded when you confirm. We will send an acknowledgement by email.':'The online form is temporarily unavailable. Please use the email or postal option below to cancel without delay.';}).catch(()=>{availability.textContent='The online form is temporarily unavailable. Please use the email or postal option below to cancel without delay.';});
 document.getElementById('edit-button').onclick=()=>{if(busy)return;stage='details';review.hidden=true;details.hidden=false;form.querySelector('[name=name]').focus();};
 form.onsubmit=async event=>{
  event.preventDefault();if(busy||!enabled)return;message.hidden=true;
  if(stage==='details'){
   if(!form.reportValidity())return;
   const data=Object.fromEntries(new FormData(form));for(const key of Object.keys(data))data[key]=data[key].trim();data.items=data.items||'Entire order';
   if(!pending||['name','order_reference','email','items'].some(key=>pending[key]!==data[key]))pending={...data,id:crypto.randomUUID()};
   const list=document.getElementById('review-details');list.replaceChildren();
   for(const [key,label]of [['name','Name'],['order_reference','Order reference'],['email','Acknowledgement email'],['items','Items to cancel']]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=pending[key];list.append(dt,dd);}
   stage='review';details.hidden=true;review.hidden=false;document.getElementById('review-title').focus();return;
  }
  busy=true;confirm.disabled=true;document.getElementById('edit-button').disabled=true;confirm.textContent='Sending…';
  try{
   const r=await fetch('/api/cancellations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending)}),result=await r.json();
   if(!r.ok||!result.received)throw Error(result.error||'We could not confirm receipt. Please retry or email us.');
   form.hidden=true;availability.hidden=true;
   document.getElementById('ack-status').textContent=result.email_sent?'Your notice has been recorded and your email acknowledgement has been sent.':'Your notice has been recorded, but the email acknowledgement could not be sent yet. Please download your acknowledgement now; we will follow up by email.';
   document.getElementById('ack-reference').textContent='Cancellation reference: '+result.reference;
   document.getElementById('ack-time').textContent='Received: '+new Date(result.received_at).toLocaleString('en-IE',{timeZone:'Europe/Dublin',timeZoneName:'short'});
   receiptURL=URL.createObjectURL(new Blob([result.receipt],{type:'text/plain;charset=utf-8'}));document.getElementById('download-receipt').href=receiptURL;
   const success=document.getElementById('success');success.hidden=false;success.focus();
  }catch(error){showError(error.message||'We could not confirm receipt. Retry or email maelinnestore@gmail.com.');}
  finally{busy=false;confirm.disabled=false;document.getElementById('edit-button').disabled=false;confirm.textContent='Confirm cancellation';}
 };
})();
