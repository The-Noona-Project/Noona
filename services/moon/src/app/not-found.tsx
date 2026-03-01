import {Column, Heading, Text} from "@once-ui-system/core";

export default function NotFound() {
    return (
        <Column as="section" fill center paddingBottom="160">
            <Text marginBottom="s" variant="display-strong-xl">
                404
            </Text>
            <Heading marginBottom="l" variant="display-default-xs">
                Moon Couldn&apos;t Find That Page
            </Heading>
            <Text onBackground="neutral-weak">The route is not part of the active Noona Moon surface.</Text>
        </Column>
    );
}
