import { z } from 'zod';

// ─── Invite ───────────────────────────────────────────────────────────────────

export const createInviteSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email address'),
  role: z.enum(['ADMIN', 'CANDIDATE']).default('CANDIDATE'),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).optional(),
  designation: z.string().min(2).max(100).optional(),
  team: z.string().min(2).max(100).optional(),
  joinedDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
});

// ─── Onboarding ───────────────────────────────────────────────────────────────

export const onboardingProfileSchema = z.object({
  // Personal
  firstName: z.string().min(1, 'First name is required').max(50),
  lastName: z.string().min(1, 'Last name is required').max(50),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').refine(value=>!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'Enter a valid date of birth.'),
  gender: z.string().min(1, 'Gender is required'),
  nationality: z.string().optional(),
  addressLine1: z.string().min(1, 'Address is required').max(200),
  addressLine2: z.string().optional(),
  city: z.string().min(1, 'City is required').max(100),
  postalCode: z.string().optional(),
  // Contact
  phoneNumber: z.string().min(7, 'Phone number is required').max(20),
  alternatePhone: z.string().optional(),
  linkedIn: z.string().url().optional().or(z.literal('')),
  emergencyContactName: z.string().min(1, 'Emergency contact name is required'),
  emergencyContactRelation: z.enum(['Father','Mother','Other'],{errorMap:()=>({message:'Choose Father, Mother, or Other for the emergency contact relationship.'})}),
  emergencyContactPhone: z.string().min(7, 'Emergency contact phone is required'),
  // Bank
  bankName: z.string().min(1, 'Bank name is required'),
  accountHolderName: z.string().min(1, 'Account holder name is required'),
  accountNumber: z.string().min(4, 'Account number is required'),
  accountType: z.enum(['SAVINGS', 'CHECKING']).default('SAVINGS'),
  currency: z.string().default('USD'),
});

// ─── Document ─────────────────────────────────────────────────────────────────

export const verifyDocumentSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  rejectionNote: z.string().optional(),
});

// ─── Contract ─────────────────────────────────────────────────────────────────

export const createContractSchema = z.object({
  candidateId: z.string().uuid(),
  title: z.string().min(1).max(200),
  templateContent: z.string().min(1),
  fieldValues: z.record(z.string(), z.string()),
});

export const signContractSchema = z.object({
  signatureDataUrl: z.string().min(1, 'Signature is required'),
});

