/*
    What holds a button disabled while the host runs something (#657): one run per kind per window.
    Each is set by the click that starts its run and cleared by the host's state message for it, and
    each outlives a model, since the host reloads the run before it says a run ended. The kind's
    own module reads and writes its lock; the Target Org Manager and the tree insert read them all.
*/
export const runLocks = {
    // THE TREE WHOSE INSERT IS RUNNING; A DATA SET ROW'S Insert… (#541) HOLDS '' HERE AND ITS DATA SET BELOW
    insertRunningTreeKey: null as string | null,
    insertRunningDatasetFolderName: null as string | null,
    // WHETHER A FRIEND IS BEING ADDED, AND "Wire to…" / "Wire TODO lookups" (#151)
    isAddFriendRunning: false,
    isWireLookupRunning: false,
    // "+ New scratch org" (#200): HOLDS THE PICKER AND EVERY INSERT DISABLED; HOW IT ENDED IS A NOTIFICATION'S (#301)
    isScratchOrgRunning: false,
    // THE LOGIN (#630) SHARES THE SCRATCH ORG RUN'S LOCK, AND ONLY ITS OWN BUTTON SAYS IT IS RUNNING
    isOrgAuthorizeRunning: false,
    // "Assign permission sets to me…" (#274, #302): HOLDS THE PICKER, EVERY INSERT AND EVERY ASSIGN BUTTON DISABLED
    isPermissionSetAssignRunning: false,
    // THE TROUBLESHOOTING TAB'S RETRIEVES (#326, #382) AND DEPLOYS (#346); THE KEY NAMES THE CARD AND THE KIND CLICKED
    isMetadataRetrieveRunning: false,
    metadataRetrieveRunningKey: null as string | null,
    isMetadataDeployRunning: false,
    metadataDeployRunningKey: null as string | null,
    // THE QUERY TAB'S RUN (#367)
    isTreeQueryRunning: false,
    // THE TREECIPE ADAPTER'S RUN (#416): THE CARD CLICKED, AND WHICH RUN -- 'load', 'generate' (#417), 'update', 'restore', 'retrieve', 'apply', 'prepareChild', 'generateChild'
    updaterLoadRunningTreeKey: null as string | null,
    updaterRunKind: '',
    // THE NEW CHILD WHOSE "Add to data set" (#447) IS RETRIEVING: PARENT, CHILD AND LOOKUP
    adapterChildPreparingKey: '',
    // THE SNAPSHOT A RESTORE (#419) WAS ASKED FOR, SO ONLY ITS BUTTON SAYS "Restoring…"
    updaterRestoringSnapshotName: '',
    // "Open in browser" (#279)
    isOrgOpenRunning: false
};
