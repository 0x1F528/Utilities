// One writer per cockpit. UI updates happen before enqueue; reconciliation happens after the burst.
export class StageQueue {
  constructor({send,reconcile,onState=()=>{},onError=()=>{}}){
    Object.assign(this,{send,reconcile,onState,onError});
    this.items=[];this.running=false;this.active=false;this.revision=0;this.waiters=[];
  }
  get pending(){return this.items.length+Number(this.active);}
  enqueue(item){this.items.push(item);this.revision++;this.onState();if(!this.running)this.drain();}
  whenIdle(){return this.running?new Promise(resolve=>this.waiters.push(resolve)):Promise.resolve(true);}
  async drain(){
    this.running=true;let succeeded=true;
    do {
      while(this.items.length){
        const item=this.items.shift();this.active=true;this.onState();
        try{await this.send(item);}
        catch(error){succeeded=false;this.items=[];this.onError(error);}
        finally{this.active=false;this.onState();}
      }
      try{await this.reconcile();}catch(error){succeeded=false;this.onError(error);}
      // Clicks received during reconciliation are processed before releasing a waiting Commit.
    }while(this.items.length);
    this.running=false;this.onState();
    for(const resolve of this.waiters.splice(0))resolve(succeeded);
  }
}
