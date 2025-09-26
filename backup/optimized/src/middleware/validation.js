const Joi = require('joi');
const { ValidationError } = require('./errorHandler');

// Enhanced validation schemas with better error messages
const schemas = {
  // Authentication schemas
  login: Joi.object({
    email: Joi.string()
      .email({ tlds: { allow: false } })
      .required()
      .messages({
        'string.email': 'Please provide a valid email address',
        'any.required': 'Email is required',
        'string.empty': 'Email cannot be empty'
      }),
    password: Joi.string()
      .min(6)
      .required()
      .messages({
        'string.min': 'Password must be at least 6 characters long',
        'any.required': 'Password is required',
        'string.empty': 'Password cannot be empty'
      })
  }),

  register: Joi.object({
    name: Joi.string()
      .trim()
      .min(2)
      .max(50)
      .pattern(/^[a-zA-Z\s]+$/)
      .required()
      .messages({
        'string.min': 'Name must be at least 2 characters long',
        'string.max': 'Name cannot exceed 50 characters',
        'string.pattern.base': 'Name can only contain letters and spaces',
        'any.required': 'Name is required',
        'string.empty': 'Name cannot be empty'
      }),
    email: Joi.string()
      .email({ tlds: { allow: false } })
      .required()
      .messages({
        'string.email': 'Please provide a valid email address',
        'any.required': 'Email is required',
        'string.empty': 'Email cannot be empty'
      }),
    password: Joi.string()
      .min(8)
      .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#\\$%\\^&\\*])'))
      .required()
      .messages({
        'string.min': 'Password must be at least 8 characters long',
        'string.pattern.base': 'Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character',
        'any.required': 'Password is required',
        'string.empty': 'Password cannot be empty'
      }),
    company_id: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .required()
      .messages({
        'string.pattern.base': 'Invalid company ID format',
        'any.required': 'Company selection is required',
        'string.empty': 'Company ID cannot be empty'
      }),
    terms_accepted: Joi.boolean()
      .valid(true)
      .required()
      .messages({
        'any.only': 'You must accept the terms and conditions',
        'any.required': 'Terms acceptance is required'
      })
  }),

  // Business schemas
  createBusiness: Joi.object({
    business_name: Joi.string()
      .trim()
      .min(2)
      .max(100)
      .required()
      .messages({
        'string.min': 'Business name must be at least 2 characters long',
        'string.max': 'Business name cannot exceed 100 characters',
        'any.required': 'Business name is required',
        'string.empty': 'Business name cannot be empty'
      }),
    business_purpose: Joi.string()
      .trim()
      .min(10)
      .max(500)
      .required()
      .messages({
        'string.min': 'Business purpose must be at least 10 characters long',
        'string.max': 'Business purpose cannot exceed 500 characters',
        'any.required': 'Business purpose is required',
        'string.empty': 'Business purpose cannot be empty'
      }),
    description: Joi.string()
      .trim()
      .max(1000)
      .optional()
      .allow('')
      .messages({
        'string.max': 'Description cannot exceed 1000 characters'
      }),
    city: Joi.string()
      .trim()
      .min(2)
      .max(50)
      .pattern(/^[a-zA-Z\s\-']+$/)
      .required()
      .messages({
        'string.min': 'City must be at least 2 characters long',
        'string.max': 'City cannot exceed 50 characters',
        'string.pattern.base': 'City can only contain letters, spaces, hyphens, and apostrophes',
        'any.required': 'City is required',
        'string.empty': 'City cannot be empty'
      }),
    country: Joi.string()
      .trim()
      .min(2)
      .max(50)
      .pattern(/^[a-zA-Z\s\-']+$/)
      .required()
      .messages({
        'string.min': 'Country must be at least 2 characters long',
        'string.max': 'Country cannot exceed 50 characters',
        'string.pattern.base': 'Country can only contain letters, spaces, hyphens, and apostrophes',
        'any.required': 'Country is required',
        'string.empty': 'Country cannot be empty'
      })
  }),

  // Conversation schemas
  saveConversation: Joi.object({
    question_id: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .required()
      .messages({
        'string.pattern.base': 'Invalid question ID format',
        'any.required': 'Question ID is required',
        'string.empty': 'Question ID cannot be empty'
      }),
    business_id: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .required()
      .messages({
        'string.pattern.base': 'Invalid business ID format',
        'any.required': 'Business ID is required',
        'string.empty': 'Business ID cannot be empty'
      }),
    user_answer: Joi.string()
      .trim()
      .min(1)
      .max(5000)
      .required()
      .messages({
        'string.min': 'Answer cannot be empty',
        'string.max': 'Answer cannot exceed 5000 characters',
        'any.required': 'Answer is required',
        'string.empty': 'Answer cannot be empty'
      }),
    phase: Joi.number()
      .integer()
      .min(1)
      .max(10)
      .required()
      .messages({
        'number.base': 'Phase must be a number',
        'number.integer': 'Phase must be an integer',
        'number.min': 'Phase must be at least 1',
        'number.max': 'Phase cannot exceed 10',
        'any.required': 'Phase is required'
      }),
    completion_status: Joi.string()
      .valid('completed', 'incomplete', 'skipped')
      .default('completed')
      .messages({
        'any.only': 'Completion status must be one of: completed, incomplete, skipped'
      })
  }),

  // Skip conversation schema
  skipConversation: Joi.object({
    question_id: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .required()
      .messages({
        'string.pattern.base': 'Invalid question ID format',
        'any.required': 'Question ID is required'
      }),
    business_id: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .required()
      .messages({
        'string.pattern.base': 'Invalid business ID format',
        'any.required': 'Business ID is required'
      }),
    phase: Joi.number()
      .integer()
      .min(1)
      .max(10)
      .required()
      .messages({
        'number.base': 'Phase must be a number',
        'number.integer': 'Phase must be an integer',
        'number.min': 'Phase must be at least 1',
        'number.max': 'Phase cannot exceed 10',
        'any.required': 'Phase is required'
      }),
    skip_reason: Joi.string()
      .trim()
      .max(500)
      .optional()
      .messages({
        'string.max': 'Skip reason cannot exceed 500 characters'
      })
  }),

  // Question schemas (Admin)
  createQuestion: Joi.object({
    question_text: Joi.string()
      .trim()
      .min(10)
      .max(1000)
      .required()
      .messages({
        'string.min': 'Question text must be at least 10 characters long',
        'string.max': 'Question text cannot exceed 1000 characters',
        'any.required': 'Question text is required',
        'string.empty': 'Question text cannot be empty'
      }),
    phase: Joi.number()
      .integer()
      .min(1)
      .max(10)
      .required()
      .messages({
        'number.base': 'Phase must be a number',
        'number.integer': 'Phase must be an integer',
        'number.min': 'Phase must be at least 1',
        'number.max': 'Phase cannot exceed 10',
        'any.required': 'Phase is required'
      }),
    severity: Joi.string()
      .valid('low', 'medium', 'high')
      .default('medium')
      .messages({
        'any.only': 'Severity must be one of: low, medium, high'
      }),
    order: Joi.number()
      .integer()
      .min(1)
      .required()
      .messages({
        'number.base': 'Order must be a number',
        'number.integer': 'Order must be an integer',
        'number.min': 'Order must be at least 1',
        'any.required': 'Order is required'
      }),
    is_active: Joi.boolean()
      .default(true),
    used_for: Joi.array()
      .items(Joi.string().valid('swot', 'customer_segmentation', 'market_analysis', 'financial_analysis'))
      .min(1)
      .required()
      .messages({
        'array.min': 'At least one usage type must be specified',
        'any.required': 'Usage types are required',
        'array.includesRequiredUnknowns': 'Invalid usage type specified'
      }),
    objective: Joi.string()
      .trim()
      .max(500)
      .optional()
      .allow('')
      .messages({
        'string.max': 'Objective cannot exceed 500 characters'
      }),
    required_info: Joi.string()
      .trim()
      .max(500)
      .optional()
      .allow('')
      .messages({
        'string.max': 'Required info cannot exceed 500 characters'
      })
  }),

  // File upload decision
  uploadDecision: Joi.object({
    decision: Joi.string()
      .valid('upload', 'skip', 'pending')
      .required()
      .messages({
        'any.only': 'Decision must be one of: upload, skip, pending',
        'any.required': 'Decision is required',
        'string.empty': 'Decision cannot be empty'
      })
  }),

  // Phase analysis schema
  phaseAnalysis: Joi.object({
    phase: Joi.number()
      .integer()
      .min(1)
      .max(10)
      .required()
      .messages({
        'number.base': 'Phase must be a number',
        'number.integer': 'Phase must be an integer',
        'number.min': 'Phase must be at least 1',
        'number.max': 'Phase cannot exceed 10',
        'any.required': 'Phase is required'
      }),
    business_id: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .required()
      .messages({
        'string.pattern.base': 'Invalid business ID format',
        'any.required': 'Business ID is required'
      }),
    analysis_type: Joi.string()
      .valid('swot', 'customer_segmentation', 'market_analysis', 'financial_analysis')
      .required()
      .messages({
        'any.only': 'Analysis type must be one of: swot, customer_segmentation, market_analysis, financial_analysis',
        'any.required': 'Analysis type is required'
      }),
    analysis_result: Joi.object()
      .required()
      .messages({
        'any.required': 'Analysis result is required',
        'object.base': 'Analysis result must be an object'
      })
  }),

  // MongoDB ObjectId validation
  objectId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .messages({
      'string.pattern.base': 'Invalid ID format'
    }),

  // Pagination schema
  pagination: Joi.object({
    page: Joi.number()
      .integer()
      .min(1)
      .default(1)
      .messages({
        'number.base': 'Page must be a number',
        'number.integer': 'Page must be an integer',
        'number.min': 'Page must be at least 1'
      }),
    limit: Joi.number()
      .integer()
      .min(1)
      .max(100)
      .default(10)
      .messages({
        'number.base': 'Limit must be a number',
        'number.integer': 'Limit must be an integer',
        'number.min': 'Limit must be at least 1',
        'number.max': 'Limit cannot exceed 100'
      })
  })
};

// Enhanced validation middleware factory
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false, // Show all validation errors
      stripUnknown: true, // Remove unknown fields
      convert: true // Convert types when possible
    });

    if (error) {
      const validationErrors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }));

      const validationError = new ValidationError('Validation failed', null, 'VALIDATION_FAILED');
      validationError.details = validationErrors;
      return next(validationError);
    }

    // Replace the original data with validated and sanitized data
    req[property] = value;
    next();
  };
};

// Enhanced sanitization middleware
const sanitize = (req, res, next) => {
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    
    return str
      // Remove potential XSS scripts
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      // Remove javascript: protocol
      .replace(/javascript:/gi, '')
      // Remove on* event handlers
      .replace(/on\w+\s*=/gi, '')
      // Remove potential SQL injection patterns
      .replace(/('|(\\')|(;)|(\\)|(--)|(\s)|(\/\*)|(\*\/))/gi, '')
      // Trim whitespace
      .trim();
  };

  const sanitizeObject = (obj) => {
    if (obj === null || typeof obj !== 'object') return obj;
    
    if (Array.isArray(obj)) {
      return obj.map(sanitizeObject);
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        sanitized[key] = sanitizeString(value);
      } else if (typeof value === 'object') {
        sanitized[key] = sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  };

  // Sanitize request data
  if (req.body) req.body = sanitizeObject(req.body);
  if (req.query) req.query = sanitizeObject(req.query);
  if (req.params) req.params = sanitizeObject(req.params);

  next();
};

// Validation helper functions
const validateObjectId = (id) => {
  const { error } = schemas.objectId.validate(id);
  return !error;
};

const validateEmail = (email) => {
  const emailSchema = Joi.string().email();
  const { error } = emailSchema.validate(email);
  return !error;
};

module.exports = {
  schemas,
  validate,
  sanitize,
  validateObjectId,
  validateEmail
};
