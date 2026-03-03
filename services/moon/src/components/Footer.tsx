"use client";

import {usePathname} from "next/navigation";
import {IconButton, Row, SmartLink, Text} from "@once-ui-system/core";
import {moonSite} from "@/resources";
import {FooterKavitaButton} from "./FooterKavitaButton";
import styles from "./Footer.module.scss";

export const Footer = () => {
    const pathname = usePathname() ?? "";
    if (pathname === "/rebooting") {
        return null;
    }

    const currentYear = new Date().getFullYear();
    const links = [
        {
            name: "GitHub",
            icon: "github",
            link: "https://github.com/The-Noona-Project/Noona",
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
                    style: {textAlign: "center"},
                }}
            >
                <Text variant="body-default-s" onBackground="neutral-strong">
                    <Text onBackground="neutral-weak">(c) {currentYear}</Text>
                    <Text paddingX="4">
                        <SmartLink href={moonSite.repositoryUrl}>{moonSite.organization}</SmartLink>
                    </Text>
                    <Text onBackground="neutral-weak">/ {moonSite.shortTitle} maintained by {moonSite.maintainer}</Text>
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
                    <FooterKavitaButton/>
                </Row>
            </Row>
            <Row height="80" hide s={{hide: false}}/>
        </Row>
    );
};
