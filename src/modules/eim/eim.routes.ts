// @ts-nocheck
import {
  deleteCompany, deleteLocation, deleteStructure, deleteCostCentre, deleteDesignation, deleteSalaryGrade, deleteCorporateTitle, deleteEmploymentType, deleteEmployeeTitle, deleteFunction, deleteFunctionalRole, deleteStatutoryClassification, deleteQualType, deleteQual, deleteQualClassification, deleteSubject, deleteRatingMethod, deleteLanguage, deleteProficiencyLevel, deleteGender, deleteMaritalStatuse, deleteNationality, deleteReligion, deleteBloodGroup, deleteRelationshipType, deleteAttachmentType, deleteCurrency, deleteMembershipType, deleteExtracurricularCategory, deleteExtracurricularType, deleteGeography, deleteBenefit, deleteDynamicField,
  updateCompany,
  updateLocation,
  updateCostCentre,
  updateDesignation,
  updateSalaryGrade,
  updateCorporateTitle,
  updateEmploymentType,
  updateEmployeeTitle,
  updateFunction,
  updateFunctionalRole,
  updateStatutoryClassification,
  updateQualType,
  updateQual,
  updateQualClassification,
  updateSubject,
  updateRatingMethod,
  updateLanguage,
  updateProficiencyLevel,
  updateGender,
  updateMaritalStatuse,
  updateNationality,
  updateReligion,
  updateBloodGroup,
  updateRelationshipType,
  updateAttachmentType,
  updateCurrency,
  updateMembershipType,
  updateExtracurricularCategory,
  updateExtracurricularType,
  updateGeography,
  updateBenefit,
  updateDynamicField
} from './eim.controller';
import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import { 
  getDashboardStats, 
  getCompanies, createCompany, 
  getLocations, createLocation, 
  getStructures, createStructure, updateStructure, updateStructureParent,
  getHierarchyConfig, updateHierarchyConfig,
  getCostCentres, createCostCentre,
  getDesignations, createDesignation, 
  getSalaryGrades, createSalaryGrade, 
  getCorporateTitles, createCorporateTitle,
  getEmploymentTypes, createEmploymentType,

  getEmployeeTitles, createEmployeeTitle,
  getFunctions, createFunction,
  getFunctionalRoles, createFunctionalRole,
  getStatutoryClassifications, createStatutoryClassification,
  getQualTypes, createQualType,
  getQuals, createQual,
  getQualClassifications, createQualClassification,
  getSubjects, createSubject,
  getRatingMethods, createRatingMethod,
  getLanguages, createLanguage,
  getProficiencyLevels, createProficiencyLevel,
  getGenders, createGender,
  getMaritalStatuses, createMaritalStatuse,
  getNationalities, createNationality,
  getReligions, createReligion,
  getBloodGroups, createBloodGroup,
  getRelationshipTypes, createRelationshipType,
  getAttachmentTypes, createAttachmentType,
  getCurrencies, createCurrency,
  getMembershipTypes, createMembershipType,
  getExtracurricularCategories, createExtracurricularCategory,
  getExtracurricularTypes, createExtracurricularType,
  getGeography, createGeography, updateGeographyParent,
  getBenefits, createBenefit,
  getDynamicFields, createDynamicField,
  getAuditLogs
} from './eim.controller';

const router = Router();

router.use(requireAuth);
router.use((req,res,next) => req.method === 'GET' ? next() : requireAdmin(req,res,next));

router.get('/dashboard-stats', getDashboardStats);

router.get('/companies', getCompanies);
router.post('/companies', createCompany);

router.get('/locations', getLocations);
router.post('/locations', createLocation);

router.get('/structures', getStructures);
router.post('/structures', createStructure);
router.put('/structures/:id', updateStructure);
router.put('/structures/:id/parent', updateStructureParent);

router.get('/hierarchy-config', getHierarchyConfig);
router.put('/hierarchy-config', updateHierarchyConfig);

router.get('/cost-centres', getCostCentres);
router.post('/cost-centres', createCostCentre);

router.post('/designations', createDesignation);
router.post('/salary-grades', createSalaryGrade);


router.get('/designations', getDesignations);
router.get('/salary-grades', getSalaryGrades);
router.get('/corporate-titles', getCorporateTitles);
router.post('/corporate-titles', createCorporateTitle);



router.get('/employment-types', getEmploymentTypes);
router.post('/employment-types', createEmploymentType);


router.get('/employee-titles', getEmployeeTitles);
router.post('/employee-titles', createEmployeeTitle);

router.get('/functions', getFunctions);
router.post('/functions', createFunction);

router.get('/functional-roles', getFunctionalRoles);
router.post('/functional-roles', createFunctionalRole);

router.get('/statutory-classifications', getStatutoryClassifications);
router.post('/statutory-classifications', createStatutoryClassification);

router.get('/qual-types', getQualTypes);
router.post('/qual-types', createQualType);
router.get('/quals', getQuals);
router.post('/quals', createQual);
router.get('/qual-classifications', getQualClassifications);
router.post('/qual-classifications', createQualClassification);
router.get('/subjects', getSubjects);
router.post('/subjects', createSubject);
router.get('/rating-methods', getRatingMethods);
router.post('/rating-methods', createRatingMethod);
router.get('/languages', getLanguages);
router.post('/languages', createLanguage);
router.get('/proficiency-levels', getProficiencyLevels);
router.post('/proficiency-levels', createProficiencyLevel);
router.get('/genders', getGenders);
router.post('/genders', createGender);
router.get('/marital-statuses', getMaritalStatuses);
router.post('/marital-statuses', createMaritalStatuse);
router.get('/nationalities', getNationalities);
router.post('/nationalities', createNationality);
router.get('/religions', getReligions);
router.post('/religions', createReligion);
router.get('/blood-groups', getBloodGroups);
router.post('/blood-groups', createBloodGroup);
router.get('/relationship-types', getRelationshipTypes);
router.post('/relationship-types', createRelationshipType);
router.get('/attachment-types', getAttachmentTypes);
router.post('/attachment-types', createAttachmentType);
router.get('/currencies', getCurrencies);
router.post('/currencies', createCurrency);
router.get('/membership-types', getMembershipTypes);
router.post('/membership-types', createMembershipType);
router.get('/extracurricular-categories', getExtracurricularCategories);
router.post('/extracurricular-categories', createExtracurricularCategory);
router.get('/extracurricular-types', getExtracurricularTypes);
router.post('/extracurricular-types', createExtracurricularType);

router.get('/geography', getGeography);
router.post('/geography', createGeography);
router.put('/geography/:id/parent', updateGeographyParent);

router.get('/benefits', getBenefits);
router.post('/benefits', createBenefit);


router.get('/dynamic-fields', getDynamicFields);
router.post('/dynamic-fields', createDynamicField);

router.get('/audit-logs', getAuditLogs);


// --- DELETE ROUTES ---
router.delete('/companies/:id', deleteCompany);
router.delete('/locations/:id', deleteLocation);
router.delete('/structures/:id', deleteStructure);
router.delete('/cost-centres/:id', deleteCostCentre);
router.delete('/designations/:id', deleteDesignation);
router.delete('/salary-grades/:id', deleteSalaryGrade);
router.delete('/corporate-titles/:id', deleteCorporateTitle);
router.delete('/employment-types/:id', deleteEmploymentType);

router.delete('/employee-titles/:id', deleteEmployeeTitle);
router.delete('/functions/:id', deleteFunction);
router.delete('/functional-roles/:id', deleteFunctionalRole);
router.delete('/statutory-classifications/:id', deleteStatutoryClassification);
router.delete('/qual-types/:id', deleteQualType);
router.delete('/quals/:id', deleteQual);
router.delete('/qual-classifications/:id', deleteQualClassification);
router.delete('/subjects/:id', deleteSubject);
router.delete('/rating-methods/:id', deleteRatingMethod);
router.delete('/languages/:id', deleteLanguage);
router.delete('/proficiency-levels/:id', deleteProficiencyLevel);
router.delete('/genders/:id', deleteGender);
router.delete('/marital-statuses/:id', deleteMaritalStatuse);
router.delete('/nationalities/:id', deleteNationality);
router.delete('/religions/:id', deleteReligion);
router.delete('/blood-groups/:id', deleteBloodGroup);
router.delete('/relationship-types/:id', deleteRelationshipType);
router.delete('/attachment-types/:id', deleteAttachmentType);
router.delete('/currencies/:id', deleteCurrency);
router.delete('/membership-types/:id', deleteMembershipType);
router.delete('/extracurricular-categories/:id', deleteExtracurricularCategory);
router.delete('/extracurricular-types/:id', deleteExtracurricularType);
router.delete('/geography/:id', deleteGeography);
router.delete('/benefits/:id', deleteBenefit);
router.delete('/dynamic-fields/:id', deleteDynamicField);

router.put('/companies/:id', updateCompany);
router.put('/locations/:id', updateLocation);
router.put('/cost-centres/:id', updateCostCentre);
router.put('/designations/:id', updateDesignation);
router.put('/salary-grades/:id', updateSalaryGrade);
router.put('/corporate-titles/:id', updateCorporateTitle);
router.put('/employment-types/:id', updateEmploymentType);
router.put('/employee-titles/:id', updateEmployeeTitle);
router.put('/functions/:id', updateFunction);
router.put('/functional-roles/:id', updateFunctionalRole);
router.put('/statutory-classifications/:id', updateStatutoryClassification);
router.put('/qual-types/:id', updateQualType);
router.put('/quals/:id', updateQual);
router.put('/qual-classifications/:id', updateQualClassification);
router.put('/subjects/:id', updateSubject);
router.put('/rating-methods/:id', updateRatingMethod);
router.put('/languages/:id', updateLanguage);
router.put('/proficiency-levels/:id', updateProficiencyLevel);
router.put('/genders/:id', updateGender);
router.put('/marital-statuses/:id', updateMaritalStatuse);
router.put('/nationalities/:id', updateNationality);
router.put('/religions/:id', updateReligion);
router.put('/blood-groups/:id', updateBloodGroup);
router.put('/relationship-types/:id', updateRelationshipType);
router.put('/attachment-types/:id', updateAttachmentType);
router.put('/currencies/:id', updateCurrency);
router.put('/membership-types/:id', updateMembershipType);
router.put('/extracurricular-categories/:id', updateExtracurricularCategory);
router.put('/extracurricular-types/:id', updateExtracurricularType);
router.put('/geography/:id', updateGeography);
router.put('/benefits/:id', updateBenefit);
router.put('/dynamic-fields/:id', updateDynamicField);

export default router;
