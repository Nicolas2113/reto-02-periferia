export const diagnosticCodes=['GEMINI_HTTP_400','GEMINI_HTTP_401','GEMINI_HTTP_403','GEMINI_HTTP_404','GEMINI_HTTP_429','GEMINI_HTTP_5XX','GEMINI_HTTP_OTHER','GEMINI_TRANSPORT','GEMINI_SCHEMA','GEMINI_PROTOCOL','GEMINI_RESPONSE_INVALID','GEMINI_RESPONSE_BLOCKED','MODEL_RESPONSE_INVALID','MODEL_TIMEOUT','APP_QUOTA','SESSION_BUDGET','REDIS_RESERVATION_FAILED','PERSISTENCE_FAILED','WORKSPACE_FAILED','AUDIT_WRITE_FAILED','AGENT_FAILED'] as const;
export type DiagnosticCode=typeof diagnosticCodes[number];
export type DiagnosticStage='provider'|'schema'|'response'|'model'|'redis_reservation'|'persistence'|'workspace'|'audit'|'agent';
export class DiagnosticError extends Error {
  constructor(readonly code:DiagnosticCode,readonly stage:DiagnosticStage,readonly httpStatus?:number){super(code);}
}
export function classify(error:unknown,stage:DiagnosticStage='agent'):DiagnosticError{
  if(error instanceof DiagnosticError&&diagnosticCodes.includes(error.code))return error;
  if(error instanceof Error){if(error.message==='timeout')return new DiagnosticError('MODEL_TIMEOUT','model');if(error.message==='quota')return new DiagnosticError('APP_QUOTA','redis_reservation');if(error.message==='budget')return new DiagnosticError('SESSION_BUDGET','model');}
  return new DiagnosticError(stage==='audit'?'AUDIT_WRITE_FAILED':stage==='persistence'?'PERSISTENCE_FAILED':stage==='redis_reservation'?'REDIS_RESERVATION_FAILED':stage==='workspace'?'WORKSPACE_FAILED':stage==='response'?'MODEL_RESPONSE_INVALID':'AGENT_FAILED',stage);
}
export function reportDiagnostic(error:unknown,context:{stage?:DiagnosticStage;provider?:string;model?:string;started:number},sink:(event:string)=>void=value=>console.error(value)):DiagnosticCode{
  const failure=classify(error,context.stage),providers=['gemini','ollama'],models=['gemini-3.8-flash','gemini-3.5-flash-lite','qwen3.5:4b'];
  const status=failure.httpStatus;
  // Construct a fresh primitive-only event. Never serialize the exception or arbitrary context.
  const event={event:'agent_diagnostic',code:failure.code,stage:failure.stage,provider:providers.includes(context.provider??'')?context.provider:'other',model:models.includes(context.model??'')?context.model:'other',...(typeof status==='number'&&Number.isInteger(status)&&status>=100&&status<=599?{httpStatus:status}:{}),durationMs:Math.max(0,Math.min(86400000,Date.now()-context.started))};
  try{sink(JSON.stringify(event));}catch{/* A diagnostic sink cannot alter business state. */}return failure.code;
}