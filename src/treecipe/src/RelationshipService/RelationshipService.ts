import { FieldInfo } from "../ObjectInfoWrapper/FieldInfo";
import { ObjectInfo } from "../ObjectInfoWrapper/ObjectInfo";
import { RelationshipDetail } from "./RelationshipDetail";
import { RelationshipTree } from "./RelationshipTree";
// import { RelationshipDetail, relationshipTree } from "../../domain/entities/RelationshipDetail";
// import { ObjectRelationshipWrapper } from "../../domain/entities/ObjectInfoWrapper";

export class RelationshipService {

    private globalValueSets: Record<string, string[]>;

    buildNewRelationshipDetail(): RelationshipDetail {

        let objectRelationshipTracker = new RelationshipDetail();
        objectRelationshipTracker.relationshipTree = new RelationshipTree();
        return objectRelationshipTracker;

    }

    updateRelationshipDetail():RelationshipDetail {

        if ( !(this.objects.get(fieldInfo.referenceTo).relationshipDetail)) {
            this.objects.get(fieldInfo.referenceTo).relationshipDetail = new RelationshipDetail();
            this.objects.get(fieldInfo.referenceTo).relationshipDetail.relationshipTree = new relationshipTree();
          } 
          let lookupRelationshipBreakdown = this.objects.get(fieldInfo.referenceTo).relationshipDetail
  
          if (!(lookupRelationshipBreakdown.childRelationshipBreakdown.objectToReferencedFields)) {
  
            let fieldReferences = [];
            fieldReferences.push(fieldInfo);
            lookupRelationshipBreakdown.childRelationshipBreakdown.objectToReferencedFields = new Map<string, FieldInfo[]>();
            lookupRelationshipBreakdown.childRelationshipBreakdown.objectToReferencedFields[fieldInfo.objectName] = fieldReferences;
  
          } else {
  
            lookupRelationshipBreakdown.childRelationshipBreakdown.objectToReferencedFields[fieldInfo.objectName].add(fieldInfo);
  
          }
          let totalFieldReferencesByOneObject = lookupRelationshipBreakdown[fieldInfo.objectName].childRelationshipBreakdown.count;
          if (lookupRelationshipBreakdown.maxTotalCountReferencedByOneObject < totalFieldReferencesByOneObject ) {
            lookupRelationshipBreakdown.maxTotalCountReferencedByOneObject = totalFieldReferencesByOneObject;
          } 
  
          let lookupRelationshipLevel = this.objects.get(fieldInfo.referenceTo).relationshipDetail.relationshipLevel;
          let currentObjectRelationshipLevel = this.objects.get(fieldInfo.objectName).relationshipDetail.relationshipLevel;
          if ( currentObjectRelationshipLevel >= lookupRelationshipLevel ) {
            let newRelationshipLevel = ( lookupRelationshipLevel - 1 );
            this.objects.get(fieldInfo.objectName).relationshipDetail.relationshipLevel = newRelationshipLevel;
          }

          
    }



    public buildRelationshipTrackerByObject(objectName: string, objectTracker: ObjectRelationshipWrapper ) {
    
        if ( !(objectTracker.objects.has(objectName)) ) {
    
            let relationshipTracker = new RelationshipDetail();
            relationshipTracker.relationshipLevel = 1;
            relationshipTracker.relationshipTree = new relationshipTree();
            
        }
    
    }

   

}