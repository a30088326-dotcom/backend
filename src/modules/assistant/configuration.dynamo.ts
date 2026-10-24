import { randomUUID } from 'crypto';
import { repository } from '../../storage/repository';
import { ensure, type Context } from './types';
import { parse } from './store';

export async function saveSettings(c: Context, v: any) {
  await repository().transaction(async tx => {
    const row = await tx.get('hr_assistant_settings',{id:'main'}); ensure(row,'Assistant settings not found.',404);
    const old = parse(row.data); ensure(old.version === v.version,'Settings changed.',409);
    const next = { ...v,version:v.version+1,confirmWrites:true };
    await tx.replace('hr_assistant_settings',{ ...row,data:next });
    await tx.create('hr_assistant_changes',{id:randomUUID(),entity_id:'main',actor_id:c.userId,kind:'SETTINGS_UPDATED',before_data:old,after_data:next});
  });
  return {message:'Assistant settings saved.',recordId:'main'};
}
export async function saveField(c: Context, v: any) {
  await repository().transaction(async tx => {
    const field = await tx.get('hr_assistant_extensions',{id:v.fieldId}); ensure(field?.active && field.version === v.fieldVersion,'Custom field changed.',409);
    const key = {field_id:v.fieldId,employee_id:v.employee};
    const old = await tx.get('hr_assistant_field_values',key); ensure((old?.version || 0) === v.version,'Value changed. Request a new preview.',409);
    const next = {...key,value:v.value,version:(old?.version || 0)+1,updated_by:c.userId};
    if (old) await tx.replace('hr_assistant_field_values',{...old,...next}); else await tx.create('hr_assistant_field_values',next);
  });
  return {message:'Employee custom field saved.',recordId:v.employee};
}
export async function createExtension(c: Context, page: string, data: any) {
  return repository().transaction(async tx => {
    // Serialize field-name uniqueness against the shared settings aggregate.
    const settings = await tx.get('hr_assistant_settings',{id:'main'}); ensure(settings,'Assistant settings not found.',404);
    if (data.kind === 'field') ensure(!(await tx.find('hr_assistant_extensions',row => row.page === page && row.active && parse(row.data).kind === 'field' && parse(row.data).name === data.name)).length,'An active custom field already uses that key.',409);
    await tx.replace('hr_assistant_settings',{...settings});
    const id = randomUUID();
    await tx.create('hr_assistant_extensions',{id,page,data,created_by:c.userId,active:1,version:1});
    await tx.create('hr_assistant_changes',{id:randomUUID(),entity_id:id,actor_id:c.userId,kind:'EXTENSION_CREATED',before_data:null,after_data:{page,data,active:true,version:1}});
    return id;
  });
}
export async function rollback(c: Context, v: any) {
  return repository().transaction(async tx => {
    const row = await tx.get('hr_assistant_extensions',{id:v.extensionId}); ensure(row?.active && row.version === v.version,'This extension changed. Request a new preview.',409);
    await tx.replace('hr_assistant_extensions',{...row,active:0,version:row.version+1});
    await tx.create('hr_assistant_changes',{id:randomUUID(),entity_id:row.id,actor_id:c.userId,kind:'EXTENSION_ROLLED_BACK',before_data:{data:parse(row.data),active:true,version:row.version},after_data:{active:false,version:row.version+1}});
    return {message:'Extension rolled back. Saved values were retained.',recordId:row.id};
  });
}
