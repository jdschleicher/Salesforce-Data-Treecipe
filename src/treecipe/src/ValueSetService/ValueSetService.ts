
export class ValueSetService {

      static getOOTBValueOptionsByStandardValueSetName(standardValueSetName: string ) : string[] {

        const standardValueSetNameByValues = {
          'EventType': [
            'Email',
            'Meeting',
            'Other',
            'Call',
          ],
        
          'FiscalYearQuarterName': [
            'Spring',
            'Summer',
            'Fall',
            'Winter',
          ],
        
          'SolutionStatus': [
            'Draft',
            'Reviewed',
            'Duplicate',
          ],
        
          'TaskSubject': [
            'Call',
            'Email',
            'Send Letter',
            'Send Quote',
            'Other',
          ],
        
          'WorkOrderLineItemStatus': [
            'New',
            'In Progress',
            'On Hold',
            'Completed',
            'Closed',
            'Cannot Complete',
            'Canceled',
          ],
        
          'CaseOrigin': [
            'Phone',
            'Email',
            'Web',
          ],
        
          'PartnerRole': [
            'System Integrator',
            'Agency',
            'Advertiser',
            'VAR/Reseller',
            'Distributor',
            'Developer',
            'Broker',
            'Lender',
            'Supplier',
            'Institution',
            'Contractor',
            'Dealer',
            'Consultant',
          ],
        
          'Industry': [
            'Agriculture',
            'Apparel',
            'Banking',
            'Biotechnology',
            'Chemicals',
            'Communications',
            'Construction',
            'Consulting',
            'Education',
            'Electronics',
            'Energy',
            'Engineering',
            'Entertainment',
            'Environmental',
            'Finance',
            'Food & Beverage',
            'Government',
            'Healthcare',
            'Hospitality',
            'Insurance',
            'Machinery',
            'Manufacturing',
            'Media',
            'Not For Profit',
            'Recreation',
            'Retail',
            'Shipping',
            'Technology',
            'Telecommunications',
            'Transportation',
            'Utilities',
            'Other',
          ],
        
          'ProcessExceptionPriority': [
            'High',
            'Low',
          ],
        
          'OrderStatus': [
            'Draft',
            'Activated',
          ],
        
          'Salutation': [
            'Mr.',
            'Ms.',
            'Mrs.',
            'Dr.',
            'Prof.',
            'Mx.',
          ],
        
          'ContractStatus': [
            'In Approval Process',
            'Activated',
            'Draft',
          ],
        
          'TaskStatus': [
            'Not Started',
            'In Progress',
            'Completed',
            'Waiting on someone else',
            'Deferred',
          ],
        
          'FiscalYearQuarterPrefix': [
            'Quarter',
            'FQ',
            'Q',
            'Trimester',
          ],
        
          'OpportunityStage': [
            'Prospecting',
            'Qualification',
            'Needs Analysis',
            'Value Proposition',
            'Id. Decision Makers',
            'Perception Analysis',
            'Proposal/Price Quote',
            'Negotiation/Review',
            'Closed Won',
            'Closed Lost',
          ],
        
          // ContactRole
          'ContactRole': [
            'Business User',
            'Decision Maker',
            'Economic Buyer',
            'Economic Decision Maker',
            'Evaluator',
            'Executive Sponsor',
            'Influencer',
            'Technical Buyer',
            'Other',
          ],
        
          'LeadStatus': [
            'Open - Not Contacted',
            'Working - Contacted',
            'Closed - Converted',
            'Closed - Not Converted',
          ],
        
          'CaseReason': [
            'Installation',
            'Equipment Complexity',
            'Performance',
            'Breakdown',
            'Equipment Design',
            'Feedback',
            'Other',
          ],
        
          'EventSubject': [
            'Call',
            'Email',
            'Meeting',
            'Send Letter/Quote',
            'Other',
          ],
        
          'CaseContactRole': [
            'Technical Contact',
            'Business Contact',
            'Decision Maker',
            'Other',
          ],
        
          'ServiceContractApprovalStatus': [
            'Draft',
            'In Approval Process',
            'Activated',
          ],
        
          'FiscalYearPeriodPrefix': [
            'Period',
            'FP',
            'P',
            'Month',
          ],
        
          'TaskType': [
            'Call',
            'Meeting',
            'Other',
            'Email',
          ],
        
          'QuantityUnitOfMeasure': [
            'Each',
          ],
        
          'CampaignMemberStatus': [
            'Planned',
            'Received',
            'Responded',
            'Sent',
          ],
        
          'AccountContactRole': [
            'Business User',
            'Decision Maker',
            'Economic Buyer',
            'Economic Decision Maker',
            'Evaluator',
            'Executive Sponsor',
            'Influencer',
            'Technical Buyer',
            'Other',
          ],
        
          'ProcessExceptionCategory': [
            'Order Activation',
            'Order Approval',
            'Fulfillment',
            'Payment',
            'Invoicing',
            'Place Order',
            'Order To Asset',
            'Order Item Summary To Asset',
            'Order To Billing Schedule',
          ],
        
          'CasePriority': [
            'High',
            'Medium',
            'Low',
          ],
        
          'CampaignStatus': [
            'Planned',
            'In Progress',
            'Completed',
            'Aborted',
          ],
        
          'LeadSource': [
            'Web',
            'Phone Inquiry',
            'Partner Referral',
            'Purchased List',
            'Other',
          ],
        
          'QuickTextCategory': [
            'Greetings',
            'FAQ',
            'Closings',
          ],
        
          'ProcessExceptionSeverity': [
            'High',
            'Low',
          ],
        
          'AccountOwnership': [
            'Public',
            'Private',
            'Subsidiary',
            'Other',
          ],
        
          'AssetStatus': [
            'Shipped',
            'Installed',
            'Registered',
            'Obsolete',
            'Purchased',
          ],
        
          'CaseStatus': [
            'New',
            'Working',
            'Escalated',
            'Closed',
          ],
        
          'TaskPriority': [
            'High',
            'Normal',
            'Low',
          ],
        
          'CampaignType': [
            'Conference',
            'Webinar',
            'Trade Show',
            'Public Relations',
            'Partners',
            'Referral Program',
            'Advertisement',
            'Banner Ads',
            'Direct Mail',
            'Email',
            'Telemarketing',
            'Other',
          ],
        
          'Product2Family': [
            'None',
          ],
        
          'EntitlementType': [
            'Phone Support',
            'Web Support',
          ],
        
          'AccountType': [
            'Prospect',
            'Customer - Direct',
            'Customer - Channel',
            'Channel Partner / Reseller',
            'Installation Partner',
            'Technology Partner',
            'Other',
          ],
        
          'QuickTextChannel': [
            'Email',
            'Portal',
            'Phone',
            'Internal',
            'Event',
            'Task',
            'Messaging',
          ],
        
          'OpportunityType': [
            'Existing Customer - Upgrade',
            'Existing Customer - Replacement',
            'Existing Customer - Downgrade',
            'New Customer',
          ],
        
          'WorkOrderStatus': [
            'New',
            'In Progress',
            'On Hold',
            'Completed',
            'Closed',
            'Cannot Complete',
            'Canceled',
          ],
        
          'CaseType': [
            'Mechanical',
            'Electrical',
            'Electronic',
            'Structural',
            'Other',
            'Repair',
            'Routine Maintenance',
          ],
        
          'ContractContactRole': [
            'Business User',
            'Decision Maker',
            'Economic Buyer',
            'Economic Decision Maker',
            'Evaluator',
            'Executive Sponsor',
            'Influencer',
            'Technical Buyer',
            'Other',
          ],
        
          'WorkOrderPriority': [
            'Low',
            'Medium',
            'High',
            'Critical',
          ],
        
          'ProcessExceptionStatus': [
            'New',
            'Triaged',
            'Paused',
            'Ignored',
            'Resolved',
            'Voided',
          ],
        
          'AccountRating': [
            'Hot',
            'Warm',
            'Cold',
          ],

        };

        return standardValueSetNameByValues[standardValueSetName];

    }

}