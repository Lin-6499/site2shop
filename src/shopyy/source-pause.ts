import {access} from 'node:fs/promises';import {join} from 'node:path';
export class SourcePauseRequested extends Error{constructor(){super('Source capture paused by the local source.pause flag');}}
/** Presence is explicit operator intent. Never clear the flag or infer approval from time. */
export async function sourcePauseRequested(evidenceRoot:string){try{await access(join(evidenceRoot,'source.pause'));return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
