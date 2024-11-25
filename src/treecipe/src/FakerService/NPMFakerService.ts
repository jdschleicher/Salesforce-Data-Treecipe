import { IFakerService } from "./IFakerService";

export class NPMFakerService implements IFakerService {

    getMapSalesforceFieldToFakerValue():Record<string, string> {

        const salesforceFieldToNPMFakerMap: Record<string, string> = {
            'text': '{{ faker.lorem.text(50) }}',
            'textarea': '{{ faker.lorem.paragraph() }}',
            'longtextarea': '{{ faker.lorem.text(1000) }}',
            'richtextarea': '{{ faker.lorem.text(1000) }}',
            'email': '{{ faker.internet.email() }}',
            'phone': '{{ faker.phone.number() }}',
            'url': '{{ faker.internet.url() }}',
            'number': '{{ faker.datatype.number({ min: 0, max: 999999 }) }}',
            'currency': '{{ faker.finance.amount(0, 999999, 2) }}',
            'percent': '{{ faker.finance.amount(0, 99, 2) }}',
            'date': '{{ faker.date.between("2023-01-01", "2024-01-01").toISOString().split("T")[0] }}',
            'datetime': '{{ faker.date.between("2023-01-01", "2024-01-01").toISOString() }}',
            'time': '{{ faker.date.recent().toISOString().split("T")[1] }}',
            'checkbox': '{{ faker.datatype.boolean() }}',
            'picklist': 'GENERATED BY FIELD XML MARKUP',
            'multiselectpicklist': 'GENERATED BY FIELD XML MARKUP',
            'lookup': '"TODO -- REFERENCE ID REQUIRED"',
            'masterdetail': '"TODO -- REFERENCE ID REQUIRED"',
            'formula': 'Formula fields are calculated, not generated',
            'location': '"SEE ONE PAGER - https://gist.github.com/jdschleicher/4abfd188a933598833285ee76e560445"',
        };

        return salesforceFieldToNPMFakerMap;
    }
}