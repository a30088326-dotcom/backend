-- Peoples Management database structure. Import into an EMPTY database.

-- Schema only: no employee records, credentials, or other live data.

SET NAMES utf8mb4;

SET FOREIGN_KEY_CHECKS=0;

CREATE TABLE `attendance_exceptions` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employeeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `date` date DEFAULT NULL,
  `exceptionType` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `details` text COLLATE utf8mb4_unicode_ci,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Pending',
  `remarks` text COLLATE utf8mb4_unicode_ci,
  `recordId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `managerId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `attachmentPath` text COLLATE utf8mb4_unicode_ci,
  `requestedValue` text COLLATE utf8mb4_unicode_ci,
  `severity` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `resolved` tinyint(1) DEFAULT '0',
  `resolutionNotes` text COLLATE utf8mb4_unicode_ci,
  `resolvedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `resolvedAt` datetime DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `attendance_raw_logs` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employeeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `deviceUserId` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `timestamp` datetime DEFAULT NULL,
  `direction` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `logType` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Web',
  `location` text COLLATE utf8mb4_unicode_ci,
  `deviceId` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `attendance_records` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employeeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `date` date DEFAULT NULL,
  `shiftId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `inTime` datetime DEFAULT NULL,
  `outTime` datetime DEFAULT NULL,
  `totalHours` decimal(10,2) DEFAULT NULL,
  `regularHours` decimal(10,2) DEFAULT NULL,
  `overtimeHours` decimal(10,2) DEFAULT NULL,
  `lateMinutes` int DEFAULT '0',
  `earlyDepartureMinutes` int DEFAULT '0',
  `isLate` tinyint(1) DEFAULT '0',
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `isException` tinyint(1) DEFAULT '0',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `attendance_roster_assignments` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `groupId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `rosterGroupId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employeeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `effectiveFrom` date DEFAULT NULL,
  `effectiveTo` date DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Active',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `shiftId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `attendance_roster_calendars` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rosterGroupId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `date` date DEFAULT NULL,
  `shiftId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `isOffDay` tinyint(1) DEFAULT '0',
  `isHoliday` tinyint(1) DEFAULT '0',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `attendance_roster_group_shifts` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `groupId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `rosterGroupId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `shiftId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `isDefault` tinyint(1) DEFAULT '0',
  `displayOrder` int DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `attendance_roster_groups` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `departmentId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branchId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `rosterCycle` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Weekly',
  `applicableEmploymentTypes` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `minRestHours` int DEFAULT '0',
  `maxConsecutiveDays` int DEFAULT '6',
  `maxWeeklyHours` decimal(10,2) DEFAULT NULL,
  `lockPeriod` int DEFAULT '0',
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Draft',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `attendance_roster_repair_backups` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `runId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tableName` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rowId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rowData` json NOT NULL,
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `repair_run` (`runId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `attendance_shifts` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `shiftType` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Fixed',
  `startTime` time DEFAULT NULL,
  `endTime` time DEFAULT NULL,
  `crossMidnight` tinyint(1) DEFAULT '0',
  `totalHours` decimal(10,2) DEFAULT NULL,
  `minWorkingHours` decimal(10,2) DEFAULT NULL,
  `fullDayHours` decimal(10,2) DEFAULT NULL,
  `halfDayHours` decimal(10,2) DEFAULT NULL,
  `breakDuration` decimal(10,2) DEFAULT NULL,
  `breakType` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Unpaid',
  `earliestIn` time DEFAULT NULL,
  `latestOut` time DEFAULT NULL,
  `graceLate` int DEFAULT '0',
  `graceEarly` int DEFAULT '0',
  `overtimeEligible` tinyint(1) DEFAULT '0',
  `overtimeStart` int DEFAULT '0',
  `weeklyWorkingDays` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `weeklyOffDays` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `holidayRule` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Off',
  `applicableEmploymentTypes` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Active',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `calendarday` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `date` date DEFAULT NULL,
  `holidayCalendarId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dayTypeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `calendargroup` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `displayName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isCompanyCalendar` tinyint(1) DEFAULT '1',
  `weekendConfiguration` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `contracts` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `candidateId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` text COLLATE utf8mb4_unicode_ci,
  `templateContent` mediumtext COLLATE utf8mb4_unicode_ci,
  `renderedContent` mediumtext COLLATE utf8mb4_unicode_ci,
  `fieldValues` json DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'DRAFT',
  `signatureUrl` text COLLATE utf8mb4_unicode_ci,
  `signedAt` datetime DEFAULT NULL,
  `signerIp` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdById` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `expiresAt` datetime DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `daytype` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `displayColor` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `leaveAmount` decimal(10,2) DEFAULT '1.00',
  `workflowStatus` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'APPROVED',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `designations` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `corporateTitleId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `salaryGradeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `departmentId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `documents` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `candidateId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fileUrl` text COLLATE utf8mb4_unicode_ci,
  `fileName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fileSize` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fileType` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'PENDING',
  `rejectionReason` text COLLATE utf8mb4_unicode_ci,
  `rejectionNote` text COLLATE utf8mb4_unicode_ci,
  `verifiedById` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `verifiedAt` datetime DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `earned_leaves` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employeeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `leaveTypeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `year` int DEFAULT NULL,
  `amount` decimal(10,2) DEFAULT '0.00',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_attachment_types` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_audit_logs` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `module` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recordType` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recordId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `previousValue` json DEFAULT NULL,
  `newValue` json DEFAULT NULL,
  `action` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `changedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reasonForChange` text COLLATE utf8mb4_unicode_ci,
  `changedAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_benefit_salary_grades` (
  `benefitId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `salaryGradeId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`benefitId`,`salaryGradeId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_benefits` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `isCash` tinyint(1) DEFAULT '0',
  `defaultAmount` decimal(10,2) DEFAULT NULL,
  `currency` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_blood_groups` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_companies` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `registrationNumber` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `taxNumber` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `address` text COLLATE utf8mb4_unicode_ci,
  `country` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contactNumber` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `logo` text COLLATE utf8mb4_unicode_ci,
  `parentCompanyId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_corporate_titles` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `level` int DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_cost_centres` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `companyId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `departmentId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_currencies` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_dynamic_fields` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fieldName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fieldLabel` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fieldType` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `applicableModule` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `options` json DEFAULT NULL,
  `isMandatory` tinyint(1) DEFAULT '0',
  `displayOrder` int DEFAULT '0',
  `validationRules` json DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1',
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `fieldName` (`fieldName`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_employee_categories` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1',
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_employee_groups` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_employee_titles` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1',
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_extracurricular_categories` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_extracurricular_types` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_functional_roles` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1',
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_functions` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1',
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_genders` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_geography` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `geoType` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `parentId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_hierarchy_config` (
  `id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `level_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_enabled` tinyint(1) DEFAULT '1',
  `level_order` int DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_hierarchy_settings` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `groupEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `divisionEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `sectionEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `teamEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_job_profiles` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `designationId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `departmentId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `purpose` text COLLATE utf8mb4_unicode_ci,
  `keyResponsibilities` text COLLATE utf8mb4_unicode_ci,
  `keyResultAreas` text COLLATE utf8mb4_unicode_ci,
  `requiredQualifications` text COLLATE utf8mb4_unicode_ci,
  `requiredExperience` text COLLATE utf8mb4_unicode_ci,
  `requiredSkills` text COLLATE utf8mb4_unicode_ci,
  `reportingPositionId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `salaryGradeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employmentTypeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `version` int DEFAULT '1',
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_languages` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_locations` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `address` text COLLATE utf8mb4_unicode_ci,
  `city` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `country` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `companyId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `locationType` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `province` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `district` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `timeZone` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contactNumber` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_marital_statuses` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_membership_types` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_nationalities` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_proficiency_levels` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_qual_classifications` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_qual_types` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_quals` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_rating_methods` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_relationship_types` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_religions` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_salary_grades` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `minSalary` decimal(15,2) DEFAULT NULL,
  `maxSalary` decimal(15,2) DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `gradeLevel` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `currency` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_statutory_classifications` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1',
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_structure_history` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `structureId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `oldParentId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `newParentId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `oldData` json DEFAULT NULL,
  `newData` json DEFAULT NULL,
  `effectiveDate` date DEFAULT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `changedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `changedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_eim_structure_history_structure` (`structureId`),
  KEY `idx_eim_structure_history_changedAt` (`changedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_structures` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `structureType` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `parentId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `companyId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `locationId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `costCentreId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `headPositionId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `unitHeadEmployeeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `status` enum('Draft','Active','Inactive') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Active',
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `eim_subjects` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `employee_information_audit` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employeeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `actionBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `actionType` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fieldChanged` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `oldValue` text COLLATE utf8mb4_unicode_ci,
  `newValue` text COLLATE utf8mb4_unicode_ci,
  `timestamp` datetime DEFAULT CURRENT_TIMESTAMP,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `employee_information_audit_log` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employeeId` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fieldName` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `oldValue` text COLLATE utf8mb4_unicode_ci,
  `newValue` text COLLATE utf8mb4_unicode_ci,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `changedBy` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `employeeId` (`employeeId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `employee_information_audit_logs` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employeeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `userId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fieldChanged` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `previousValue` text COLLATE utf8mb4_unicode_ci,
  `newValue` text COLLATE utf8mb4_unicode_ci,
  `ipAddress` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `employee_information_bank_details` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employeeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bankName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branchName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `accountNumber` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `accountNo` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `accountHolderName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `accountType` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `currency` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT 'LKR',
  `transferMode` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Percentage',
  `amountOrPercentage` decimal(10,2) DEFAULT '100.00',
  `priority` int DEFAULT '1',
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `employee_information_contact_details` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employeeId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `permanent` text COLLATE utf8mb4_unicode_ci,
  `working` text COLLATE utf8mb4_unicode_ci,
  `official` text COLLATE utf8mb4_unicode_ci,
  `residential` text COLLATE utf8mb4_unicode_ci,
  `primaryContactOption` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `linkedIn` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `employee_information_employee_attachments` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employeeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fileName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fileUrl` text COLLATE utf8mb4_unicode_ci,
  `fileType` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fileSize` int DEFAULT NULL,
  `uploadedAt` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `employee_information_employees` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `userId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employeeNumber` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employeeNo` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `firstName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lastName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `callingName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `designation` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `department` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reportingManagerId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employmentType` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dateJoined` date DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Active',
  `employeeStatus` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Active',
  `avatar` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `barcodeNo` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payrollNo` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `timeAndAttendanceActive` tinyint(1) DEFAULT '1',
  `payrollActive` tinyint(1) DEFAULT '1',
  `probationStatus` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT 'Probation',
  `permanentEffectiveDate` date DEFAULT NULL,
  `employeeGroup` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employmentTypeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `reportingEffectiveFrom` date DEFAULT NULL,
  `companyId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `locationId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `departmentId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `designationId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `salaryGradeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employeeGroupId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `jobProfileId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `organizationalRank` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'EMPLOYEE',
  PRIMARY KEY (`id`),
  KEY `fk_emp_reporting_manager` (`reportingManagerId`),
  CONSTRAINT `fk_emp_reporting_manager` FOREIGN KEY (`reportingManagerId`) REFERENCES `employee_information_employees` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `employee_information_personal_details` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employeeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `firstName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lastName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dob` date DEFAULT NULL,
  `nic` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nicNumber` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `passportNumber` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `maritalStatus` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bloodGroup` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `religion` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gender` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dateOfBirth` date DEFAULT NULL,
  `nationality` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `title` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `middleName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `preferredName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fullName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nicNo` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `civilStatus` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `passportNo` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `employee_information_resignation_details` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employeeId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dateResigned` date DEFAULT NULL,
  `dateOfRetirement` date DEFAULT NULL,
  `reasonForLeaving` text COLLATE utf8mb4_unicode_ci,
  `noticePeriod` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `exitInterviewConducted` tinyint(1) DEFAULT '0',
  `handoverNotes` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `employee_information_workstation_details` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employeeId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `companyId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `locationId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `departmentId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `designationId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sectionId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `divisionId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `functionalRole` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `shiftId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `salaryGradeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employmentTypeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employeeGroupId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `jobProfileId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `businessUnit` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `section` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `indirectSupervisorId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `costCentreId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `costAllocationPercentage` decimal(5,2) DEFAULT '100.00',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `employee_profile_extras` (
  `employeeId` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `data` json NOT NULL,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`employeeId`),
  CONSTRAINT `fk_profile_extras_employee` FOREIGN KEY (`employeeId`) REFERENCES `employee_information_employees` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `employee_requests` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employeeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `requestType` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `dataPayload` json DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Pending Approval',
  `rejectionReason` text COLLATE utf8mb4_unicode_ci,
  `approvedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approvedAt` datetime DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `employee_salary_histories` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employeeId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `basicSalary` decimal(15,2) DEFAULT NULL,
  `currency` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT 'LKR',
  `effectiveDate` date DEFAULT NULL,
  `incrementAmount` decimal(15,2) DEFAULT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `approvedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `employment_types` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `effectiveStartDate` date DEFAULT NULL,
  `effectiveEndDate` date DEFAULT NULL,
  `createdBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedBy` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `holidaycalendar` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `year` int DEFAULT NULL,
  `calendarGroupId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `hr_assistant_actions` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `actor_role` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `conversation_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tool` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `module` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `args` json NOT NULL,
  `summary` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `before_data` json DEFAULT NULL,
  `result` json DEFAULT NULL,
  `confirmed_at` datetime(3) DEFAULT NULL,
  `expires_at` datetime(3) NOT NULL,
  `created_at` datetime(3) DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `action_owner` (`user_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `hr_assistant_changes` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `actor_id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `kind` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `before_data` json DEFAULT NULL,
  `after_data` json DEFAULT NULL,
  `at` datetime(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `hr_assistant_conversations` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `context` json NOT NULL,
  `created_at` datetime(3) DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `owner_lookup` (`user_id`,`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `hr_assistant_extensions` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `page` varchar(70) COLLATE utf8mb4_unicode_ci NOT NULL,
  `data` json NOT NULL,
  `version` int NOT NULL DEFAULT '1',
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `updated_at` datetime(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `hr_assistant_field_values` (
  `field_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` json NOT NULL,
  `version` int NOT NULL DEFAULT '1',
  `updated_by` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `updated_at` datetime(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`field_id`,`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `hr_assistant_messages` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `conversation_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `text` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `at` datetime(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `conversation_lookup` (`conversation_id`,`at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `hr_assistant_read_updates` (
  `user_id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_id` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `read_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`,`event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `hr_assistant_settings` (
  `id` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `data` json NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `hr_performance_audit` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `actor_id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `event` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `entity_history` (`entity_id`,`at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `hr_performance_cycles` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `data` json NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `hr_performance_library` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `data` json NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `hr_performance_notifications` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `review_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `message` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `read_at` datetime(3) DEFAULT NULL,
  `at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `user_inbox` (`user_id`,`at`),
  KEY `hr_pm_notification_review` (`review_id`),
  CONSTRAINT `hr_pm_notification_review` FOREIGN KEY (`review_id`) REFERENCES `hr_performance_reviews` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `hr_performance_reviews` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cycle_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `data` json NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_cycle_employee` (`cycle_id`,`employee_id`),
  KEY `employee_lookup` (`employee_id`),
  CONSTRAINT `hr_pm_review_cycle` FOREIGN KEY (`cycle_id`) REFERENCES `hr_performance_cycles` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `hr_performance_templates` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `data` json NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `hr_repair_migrations` (
  `id` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `applied_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `report` json DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `invites` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `token` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'CANDIDATE',
  `employmentType` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `designation` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `team` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `joinedDate` date DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'PENDING',
  `expiresAt` datetime DEFAULT NULL,
  `acceptedAt` datetime DEFAULT NULL,
  `declinedAt` datetime DEFAULT NULL,
  `invitedById` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `invitedUserId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `leave_applications` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `applicantId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employeeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `leaveTypeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `leaveYearId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `startDate` date DEFAULT NULL,
  `endDate` date DEFAULT NULL,
  `totalDays` decimal(10,2) DEFAULT NULL,
  `halfDayType` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'NONE',
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'PENDING',
  `comments` text COLLATE utf8mb4_unicode_ci,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `coveringEmployeeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `attachmentUrl` text COLLATE utf8mb4_unicode_ci,
  `supervisorComment` text COLLATE utf8mb4_unicode_ci,
  `actionedAt` datetime DEFAULT NULL,
  `actionedById` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approverId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approvedAt` datetime DEFAULT NULL,
  `rejectedReason` text COLLATE utf8mb4_unicode_ci,
  `medCertSubmitted` tinyint(1) DEFAULT '0',
  `medCertRefNo` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `medCertIssuedDate` date DEFAULT NULL,
  `cancelledAt` datetime DEFAULT NULL,
  `cancelReason` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `leave_approval_history` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `leave_application_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `approver_user_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `level` int DEFAULT '0',
  `comment` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_leave_application` (`leave_application_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `leave_entitlements` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `userId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `leaveTypeId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `leaveYearId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `totalDays` decimal(10,2) DEFAULT '0.00',
  `usedDays` decimal(10,2) DEFAULT '0.00',
  `pendingDays` decimal(10,2) DEFAULT '0.00',
  `carryForwardDays` decimal(10,2) DEFAULT '0.00',
  `earnedDays` decimal(10,2) DEFAULT '0.00',
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'PROCESSED',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `leave_group_types` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `leaveGroupId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `leaveTypeId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entitlementDays` decimal(10,2) DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `unit` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Working Days',
  `allocationMethod` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Yearly',
  `allowProration` tinyint(1) DEFAULT '1',
  `allowCarryForward` tinyint(1) DEFAULT '1',
  `carryForwardLimit` decimal(10,2) DEFAULT '0.00',
  `minimumServiceMonths` int DEFAULT '0',
  `maximumConsecutiveDays` int DEFAULT NULL,
  `approvalWorkflow` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT 'Manager -> HR',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `leave_groups` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employmentType` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `country` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `startingMonth` int DEFAULT '1',
  `effectiveFrom` date DEFAULT NULL,
  `effectiveTo` date DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `leave_rule_scripts` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `content` text COLLATE utf8mb4_unicode_ci,
  `isDefault` tinyint(1) DEFAULT '0',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `leave_types` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `color` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1',
  `allowHalfDays` tinyint(1) DEFAULT '1',
  `requireCoveringEmp` tinyint(1) DEFAULT '0',
  `yearlyEntitlement` decimal(10,2) DEFAULT '14.00',
  `needMedicalCertificate` tinyint(1) DEFAULT '0',
  `maxDaysWithoutMedCert` decimal(10,2) DEFAULT '2.00',
  `requireAttachment` tinyint(1) DEFAULT '0',
  `isNoPayLeave` tinyint(1) DEFAULT '0',
  `isMaternityLeave` tinyint(1) DEFAULT '0',
  `carryForwardEnabled` tinyint(1) DEFAULT '0',
  `carryForwardMaxDays` decimal(10,2) DEFAULT '0.00',
  `showBalance` tinyint(1) DEFAULT '1',
  `allowNegativeBalance` tinyint(1) DEFAULT '0',
  `showReason` tinyint(1) DEFAULT '0',
  `commentMandatory` tinyint(1) DEFAULT '0',
  `autoCalculateEndDate` tinyint(1) DEFAULT '1',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `category` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT 'Planned Leave',
  `unit` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Working Days',
  `paymentType` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Paid',
  `allowFullDay` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `leave_years` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `year` int NOT NULL,
  `displayName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1',
  `startDate` date DEFAULT NULL,
  `endDate` date DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `year` (`year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `onboarding_profiles` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `candidateId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `firstName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lastName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `city` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dateOfBirth` date DEFAULT NULL,
  `gender` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nationality` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `addressLine1` text COLLATE utf8mb4_unicode_ci,
  `addressLine2` text COLLATE utf8mb4_unicode_ci,
  `postalCode` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phoneNumber` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `alternatePhone` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `linkedIn` text COLLATE utf8mb4_unicode_ci,
  `emergencyContactName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emergencyContactRelation` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emergencyContactPhone` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bankName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `accountHolderName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `accountNumber` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `accountType` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `currency` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `performance_360_feedback` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `review_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reviewer_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `relationship_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'INVITED',
  `invited_at` datetime DEFAULT NULL,
  `submitted_at` datetime DEFAULT NULL,
  `rating` int DEFAULT NULL,
  `comment` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_perf_360_review` (`review_id`),
  KEY `idx_perf_360_reviewer` (`reviewer_id`),
  KEY `idx_perf_360_status` (`status`),
  CONSTRAINT `fk_perf_360_review` FOREIGN KEY (`review_id`) REFERENCES `performance_reviews` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_perf_360_reviewer` FOREIGN KEY (`reviewer_id`) REFERENCES `employee_information_employees` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `performance_360_requests` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `review_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `requested_by` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reviewer_employee_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviewer_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviewer_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `relationship` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'INVITED',
  `invitation_token` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `invited_at` datetime DEFAULT NULL,
  `submitted_at` datetime DEFAULT NULL,
  `declined_at` datetime DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  `response_comment` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_perf_360_review` (`review_id`),
  KEY `idx_perf_360_reviewer` (`reviewer_employee_id`),
  KEY `idx_perf_360_status` (`status`),
  KEY `idx_perf_360_requested_by` (`requested_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `performance_audit_logs` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_type` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `performed_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_perf_audit_emp` (`employee_id`),
  CONSTRAINT `performance_audit_logs_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employee_information_employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `performance_cycle_eligible_employees` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `performance_cycle_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `eligibility_reason` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `included_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_perf_cycle_employee` (`performance_cycle_id`,`employee_id`),
  KEY `idx_perf_cycle_eligible_cycle` (`performance_cycle_id`),
  KEY `idx_perf_cycle_eligible_employee` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `performance_cycles` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DRAFT',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `template_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `frequency` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `self_assessment_deadline` date DEFAULT NULL,
  `manager_assessment_deadline` date DEFAULT NULL,
  `completion_date` date DEFAULT NULL,
  `overall_score_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `feedback_360_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `automatic_reminders` tinyint(1) NOT NULL DEFAULT '0',
  `exclude_probation` tinyint(1) NOT NULL DEFAULT '0',
  `exclude_new_joiners` tinyint(1) NOT NULL DEFAULT '0',
  `exclude_notice_period` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `fk_perf_cycles_template` (`template_id`),
  CONSTRAINT `fk_perf_cycles_template` FOREIGN KEY (`template_id`) REFERENCES `performance_review_templates` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `performance_development_actions` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `review_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `target_date` date DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PLANNED',
  `created_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_perf_dev_actions_review` (`review_id`),
  KEY `idx_perf_dev_actions_employee` (`employee_id`),
  KEY `idx_perf_dev_actions_status` (`status`),
  KEY `fk_perf_dev_actions_created_by` (`created_by`),
  KEY `fk_perf_dev_actions_updated_by` (`updated_by`),
  CONSTRAINT `fk_perf_dev_actions_created_by` FOREIGN KEY (`created_by`) REFERENCES `employee_information_employees` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_perf_dev_actions_employee` FOREIGN KEY (`employee_id`) REFERENCES `employee_information_employees` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_perf_dev_actions_review` FOREIGN KEY (`review_id`) REFERENCES `performance_reviews` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_perf_dev_actions_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `employee_information_employees` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `performance_development_plans` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `performance_cycle_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `development_area` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action_plan` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_date` date DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OPEN',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `performance_cycle_id` (`performance_cycle_id`),
  KEY `idx_perf_dev_emp` (`employee_id`),
  CONSTRAINT `performance_development_plans_ibfk_1` FOREIGN KEY (`performance_cycle_id`) REFERENCES `performance_cycles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `performance_development_plans_ibfk_2` FOREIGN KEY (`employee_id`) REFERENCES `employee_information_employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `performance_feedback` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `performance_cycle_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employee_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `from_employee_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `feedback` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `performance_cycle_id` (`performance_cycle_id`),
  KEY `idx_perf_feedback_emp` (`employee_id`),
  KEY `idx_perf_feedback_from` (`from_employee_id`),
  CONSTRAINT `performance_feedback_ibfk_1` FOREIGN KEY (`performance_cycle_id`) REFERENCES `performance_cycles` (`id`) ON DELETE SET NULL,
  CONSTRAINT `performance_feedback_ibfk_2` FOREIGN KEY (`employee_id`) REFERENCES `employee_information_employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `performance_feedback_ibfk_3` FOREIGN KEY (`from_employee_id`) REFERENCES `employee_information_employees` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `performance_goal_checkins` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `goal_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `check_in_date` date NOT NULL,
  `progress` decimal(5,2) NOT NULL DEFAULT '0.00',
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OPEN',
  `comment` text COLLATE utf8mb4_unicode_ci,
  `blocker` text COLLATE utf8mb4_unicode_ci,
  `support_required` text COLLATE utf8mb4_unicode_ci,
  `attachment_reference` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_perf_goal_checkins_goal` (`goal_id`),
  KEY `idx_perf_goal_checkins_created_by` (`created_by`),
  CONSTRAINT `fk_perf_goal_checkins_created_by` FOREIGN KEY (`created_by`) REFERENCES `employee_information_employees` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_perf_goal_checkins_goal` FOREIGN KEY (`goal_id`) REFERENCES `performance_goals` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `performance_goals` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `performance_cycle_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `target` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `progress` decimal(5,2) DEFAULT '0.00',
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DRAFT',
  `employee_comment` text COLLATE utf8mb4_unicode_ci,
  `manager_comment` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `category` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `priority` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `success_measurement` text COLLATE utf8mb4_unicode_ci,
  `linked_objective` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_perf_goals_emp` (`employee_id`),
  KEY `idx_perf_goals_cycle` (`performance_cycle_id`),
  CONSTRAINT `performance_goals_ibfk_1` FOREIGN KEY (`performance_cycle_id`) REFERENCES `performance_cycles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `performance_goals_ibfk_2` FOREIGN KEY (`employee_id`) REFERENCES `employee_information_employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `performance_review_answers` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `review_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `question_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `answer_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rating` int DEFAULT NULL,
  `text_answer` text COLLATE utf8mb4_unicode_ci,
  `numeric_value` decimal(18,4) DEFAULT NULL,
  `date_value` date DEFAULT NULL,
  `boolean_value` tinyint(1) DEFAULT NULL,
  `answered_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `assessment_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'EMPLOYEE',
  PRIMARY KEY (`id`),
  KEY `idx_perf_review_answers_review` (`review_id`),
  KEY `idx_perf_review_answers_question` (`question_id`),
  KEY `idx_perf_review_answers_employee` (`answered_by`),
  KEY `idx_performance_review_answers_assessment_type` (`assessment_type`),
  CONSTRAINT `fk_perf_review_answers_employee` FOREIGN KEY (`answered_by`) REFERENCES `employee_information_employees` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_perf_review_answers_question` FOREIGN KEY (`question_id`) REFERENCES `performance_review_template_questions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_perf_review_answers_review` FOREIGN KEY (`review_id`) REFERENCES `performance_reviews` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `performance_review_history` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `review_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cycle_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `event_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `previous_status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `new_status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employee_score` decimal(5,2) DEFAULT NULL,
  `manager_score` decimal(5,2) DEFAULT NULL,
  `changed_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `event_date` datetime NOT NULL,
  `metadata` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_perf_review_history_review` (`review_id`),
  KEY `idx_perf_review_history_employee` (`employee_id`),
  KEY `idx_perf_review_history_event` (`event_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `performance_review_template_question_options` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `question_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `option_value` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_label` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_order` int NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_perf_options_question` (`question_id`),
  CONSTRAINT `fk_perf_options_question` FOREIGN KEY (`question_id`) REFERENCES `performance_review_template_questions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `performance_review_template_questions` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `section_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `question_text` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `help_text` text COLLATE utf8mb4_unicode_ci,
  `question_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_required` tinyint(1) NOT NULL DEFAULT '0',
  `employee_visible` tinyint(1) NOT NULL DEFAULT '1',
  `manager_visible` tinyint(1) NOT NULL DEFAULT '1',
  `reviewer_360_visible` tinyint(1) NOT NULL DEFAULT '0',
  `display_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_perf_template_questions_section` (`section_id`),
  CONSTRAINT `fk_perf_template_questions_section` FOREIGN KEY (`section_id`) REFERENCES `performance_review_template_sections` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `performance_review_template_sections` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `template_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `description` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  KEY `idx_perf_template_sections_template` (`template_id`),
  CONSTRAINT `fk_perf_template_sections_template` FOREIGN KEY (`template_id`) REFERENCES `performance_review_templates` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `performance_review_templates` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `version` int NOT NULL DEFAULT '1',
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DRAFT',
  `created_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `template_key` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `published_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `published_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_perf_templates_status` (`status`),
  KEY `fk_perf_templates_created_by` (`created_by`),
  KEY `fk_perf_templates_updated_by` (`updated_by`),
  CONSTRAINT `fk_perf_templates_created_by` FOREIGN KEY (`created_by`) REFERENCES `employee_information_employees` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_perf_templates_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `employee_information_employees` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `performance_reviews` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `performance_cycle_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reviewer_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `self_assessment` text COLLATE utf8mb4_unicode_ci,
  `manager_review` text COLLATE utf8mb4_unicode_ci,
  `manager_score` int DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DRAFT',
  `submitted_at` datetime DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employee_score` int DEFAULT NULL,
  `closed_date` datetime DEFAULT NULL,
  `closed_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_perf_review_employee_cycle` (`employee_id`,`performance_cycle_id`),
  KEY `idx_perf_reviews_emp` (`employee_id`),
  KEY `idx_perf_reviews_cycle` (`performance_cycle_id`),
  KEY `idx_perf_reviews_reviewer` (`reviewer_id`),
  CONSTRAINT `performance_reviews_ibfk_1` FOREIGN KEY (`performance_cycle_id`) REFERENCES `performance_cycles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `performance_reviews_ibfk_2` FOREIGN KEY (`employee_id`) REFERENCES `employee_information_employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `performance_reviews_ibfk_3` FOREIGN KEY (`reviewer_id`) REFERENCES `employee_information_employees` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `reporting_hierarchy_audit` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `previous_manager_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `new_manager_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `effective_date` date DEFAULT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `remarks` text COLLATE utf8mb4_unicode_ci,
  `transfer_pending_approvals` tinyint(1) DEFAULT '0',
  `changed_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `reporting_hierarchy_levels` (
  `depth` int NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`depth`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `reporting_relationships` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `manager_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `relationship_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'PRIMARY',
  `effective_start_date` date NOT NULL,
  `effective_end_date` date DEFAULT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `remarks` text COLLATE utf8mb4_unicode_ci,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Active',
  `created_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `user_module_permissions` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `userId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `moduleId` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `moduleAccess` tinyint(1) DEFAULT '0',
  `canView` tinyint(1) DEFAULT '0',
  `canCreate` tinyint(1) DEFAULT '0',
  `canEdit` tinyint(1) DEFAULT '0',
  `canDelete` tinyint(1) DEFAULT '0',
  `canApprove` tinyint(1) DEFAULT '0',
  `canExport` tinyint(1) DEFAULT '0',
  `dataScope` enum('OWN','DIRECT_REPORTS','DEPARTMENT','ALL') COLLATE utf8mb4_unicode_ci DEFAULT 'OWN',
  `createdAt` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_user_module` (`userId`,`moduleId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `users` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` text COLLATE utf8mb4_unicode_ci,
  `role` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'CANDIDATE',
  `isActive` tinyint(1) DEFAULT '1',
  `supervisorId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `mustChangePassword` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS=1;
