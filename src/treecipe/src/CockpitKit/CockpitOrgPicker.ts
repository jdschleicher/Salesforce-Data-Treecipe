/*
    The Target Org Manager's look, shared by every cockpit (#524): the org dropdown, its type chip, the
    listing spinner, the refresh button, and the pinned section that holds them while cards scroll
    under it. The picker's VIEW and its index protocol are extracted with the second cockpit that uses
    them (#525); what an org can be listed, selected or written to stays SalesforceOrgService's.
*/
export const COCKPIT_SPINNER_ROTATION_MILLISECONDS = 800;

// HOW FAR BELOW THE TOP A ROW SCROLLED INTO VIEW STOPS, SO THE PINNED ORG SECTION NEVER COVERS IT (#364)
export const COCKPIT_PINNED_ORG_SECTION_SCROLL_PADDING = '10rem';
