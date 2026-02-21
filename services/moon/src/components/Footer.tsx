import {IconButton, Row, SmartLink, Text} from "@once-ui-system/core";
import styles from "./Footer.module.scss";

export const Footer = () => {
    const currentYear = new Date().getFullYear();
    const links = [
        {
            name: "GitHub",
            icon: "github",
            link: "https://github.com/The-Noona-Project",
        },
        {
            name: "Discord",
            icon: "discord",
            link: "https://discord.gg/ukhtZrgJ9e",
        },
    ];

    return (
        <Row as="footer" fillWidth padding="8" horizontal="center" s={{direction: "column"}}>
            <Row
                className={styles.mobile}
                maxWidth="m"
                paddingY="8"
                paddingX="16"
                gap="16"
                horizontal="between"
                vertical="center"
                s={{
                    direction: "column",
                    horizontal: "center",
                    align: "center",
                }}
            >
                <Text variant="body-default-s" onBackground="neutral-strong">
                    <Text onBackground="neutral-weak">(c) {currentYear} /</Text>
                    <Text paddingX="4">Website built by Pax-kun</Text>
                    <Text onBackground="neutral-weak">
                        {/* Usage of this template requires attribution. Please don't remove the link to Once UI unless you have a Pro license. */}
                        / Powered by{" "}
                        <SmartLink href="https://once-ui.com/products/magic-portfolio">Once UI</SmartLink>
                    </Text>
                </Text>
                <Row gap="16">
                    {links.map((item) => (
                        <IconButton
                            key={item.name}
                            href={item.link}
                            icon={item.icon}
                            tooltip={item.name}
                            size="s"
                            variant="ghost"
                        />
                    ))}
                </Row>
            </Row>
            <Row height="80" hide s={{hide: false}}/>
        </Row>
    );
};
