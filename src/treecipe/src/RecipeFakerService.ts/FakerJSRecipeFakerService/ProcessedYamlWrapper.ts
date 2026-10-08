
export type GeneratedRecord = {
    id: number;
    object: string;
    nickname: string;
    fields: Record<string, unknown>;
};

/*
    A generated record with what the post-generation pass needs to resolve a reference to it, or
    from it: the YAML nickname of the entry that generated it, and which of its fields were already
    pointed at an ancestor record (#189).
*/
export type GeneratedRecordContext = {
    record: GeneratedRecord;
    yamlNickname: string | undefined;
    ancestorResolvedFieldNames: Set<string>;
};

export class ProcessedYamlWrapper {
  
    ObjectPropertyToExistingProcessedYaml: Record<string, any>;
    VariablePropertyToExistingProcessedYaml: Record<string, any>;
    // IN GENERATION ORDER
    GeneratedRecordContexts?: GeneratedRecordContext[];
  
}
