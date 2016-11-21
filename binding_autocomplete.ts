interface KnockoutBindingHandlers {
    autocomplete3: KnockoutBindingHandler;
}

ko.bindingHandlers.autocomplete3 = {
    init: function (element: HTMLElement, valueAccessor: Function, allBindings?: KnockoutAllBindingsAccessor, viewModel?: any, bindingContext?: KnockoutBindingContext) {
        let config = <IAutocomplete3BindingOptions>valueAccessor();
        config.dataType = 'json';
        config.noSuggestionNotice = "No results found!";
        config.showNoSuggestionNotice = true;
        if (config.action) {
            config.serviceUrl = `/AutoComplete/${config.action}`;
        }
        if (config.depends) {
            console.log(config.depends);
            config.params = ko.unwrap(config.depends);
        }
        config.transformResult = function (rawList: Moon.IIdNameViewModel[], originalQuery: string) {
            if (rawList) {
                return {
                    suggestions: _.map(rawList, (item) => {
                        return {
                            value: item.name,
                            data: item.id
                        }
                    })
                };
            }
            return null;
        }
        $(element).dbAutocomplete(config);
    }
}

interface IAutocomplete3BindingOptions extends DbAutocompleteOptions {
    action: string;
    depends: Array<KnockoutObservable<string>>;
}