// Runs only local parse jobs created by the V2 ingestion protocol. It does not
// replay legacy tasks or run model calls. The APP remains the sole DB writer.
import {isParserInfrastructureError} from '../knowledge/parser-errors.mjs';
export class IngestScheduler {
  constructor(ingestion,parse,{intervalMs=250,prepare=async()=>{}}={}){
    this.ingestion=ingestion;this.parse=parse;this.prepare=prepare;this.active=null;this.closed=false;this.failure=null;
    this.timer=setInterval(()=>this.notify(),intervalMs);this.timer.unref();this.notify();
  }
  notify(){
    if(this.closed||this.failure)return;
    try{
      if(this.active){if(this.active.claimed&&!this.ingestion.isCurrent(this.active.id))this.active.controller.abort(new Error('ingest_cancelled'));return;}
      const job=this.ingestion.nextPending();if(!job)return;
      const active={id:job.id,controller:new AbortController(),promise:null,claimed:false};this.active=active;
      active.promise=Promise.resolve().then(()=>this.prepare()).then(()=>{
        active.controller.signal.throwIfAborted();active.claimed=true;
        return this.ingestion.process(job.id,this.parse,active.controller.signal);
      }).catch(error=>{
        if(!this.closed&&(!active.claimed||isParserInfrastructureError(error))){this.failure=error;this.ingestion.defer(job.id,error.code??'parser_unavailable');}
        // Document failures are persisted by Ingestion; infrastructure pauses
        // the queue without consuming other pending work. No automatic retry.
      })
        .finally(()=>{this.active=null;if(!this.closed)queueMicrotask(()=>this.notify());});
    }catch(error){this.failure=error;this.active?.controller.abort(error);}
  }
  resume(){if(!this.closed){this.failure=null;this.notify();}}
  get status(){return {state:this.failure?'unavailable':this.closed?'closed':'ready',errorCode:this.failure?.code??(this.failure?'parser_unavailable':null)};}
  async close(){this.closed=true;clearInterval(this.timer);this.active?.controller.abort(Object.assign(new Error('application_closing'),{code:'application_closing'}));await this.active?.promise;}
}
