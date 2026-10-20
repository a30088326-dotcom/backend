import 'dotenv/config';
import { ensureProfileRequestStorage } from '../src/modules/employee_information/profile-requests';
import { db } from '../src/lib/db';
ensureProfileRequestStorage().then(()=>console.log('Profile request storage ready. No existing employee or leave records changed.')).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.end());
