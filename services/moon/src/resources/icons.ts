import {IconType} from "react-icons";

import {
    HiArrowRight,
    HiArrowTopRightOnSquare,
    HiArrowUpRight,
    HiCalendarDays,
    HiEnvelope,
    HiOutlineCog6Tooth,
    HiOutlineDocument,
    HiOutlineEye,
    HiOutlineEyeSlash,
    HiOutlineGlobeAsiaAustralia,
    HiOutlineLink,
    HiOutlineRocketLaunch,
} from "react-icons/hi2";

import {
    PiBookBookmarkDuotone,
    PiDeviceMobileDuotone,
    PiGridFourDuotone,
    PiHouseDuotone,
    PiImageDuotone,
    PiLaptopDuotone,
    PiMonitorDuotone,
    PiUserCircleDuotone,
} from "react-icons/pi";

import {SiFigma, SiJavascript, SiNextdotjs, SiSupabase,} from "react-icons/si";

import {
    FaDiscord,
    FaFacebook,
    FaGithub,
    FaInstagram,
    FaLinkedin,
    FaPinterest,
    FaReddit,
    FaTelegram,
    FaThreads,
    FaWhatsapp,
    FaX,
    FaXTwitter,
} from "react-icons/fa6";

export const iconLibrary: Record<string, IconType> = {
    arrowUpRight: HiArrowUpRight,
    arrowRight: HiArrowRight,
    email: HiEnvelope,
    globe: HiOutlineGlobeAsiaAustralia,
    person: PiUserCircleDuotone,
    grid: PiGridFourDuotone,
    book: PiBookBookmarkDuotone,
    openLink: HiOutlineLink,
    calendar: HiCalendarDays,
    home: PiHouseDuotone,
    gallery: PiImageDuotone,
    discord: FaDiscord,
    eye: HiOutlineEye,
    eyeOff: HiOutlineEyeSlash,
    github: FaGithub,
    linkedin: FaLinkedin,
    x: FaX,
    twitter: FaXTwitter,
    threads: FaThreads,
    arrowUpRightFromSquare: HiArrowTopRightOnSquare,
    document: HiOutlineDocument,
    settings: HiOutlineCog6Tooth,
    rocket: HiOutlineRocketLaunch,
    desktop: PiLaptopDuotone,
    ultrawide: PiMonitorDuotone,
    mobile: PiDeviceMobileDuotone,
    javascript: SiJavascript,
    nextjs: SiNextdotjs,
    supabase: SiSupabase,
    figma: SiFigma,
    facebook: FaFacebook,
    pinterest: FaPinterest,
    whatsapp: FaWhatsapp,
    reddit: FaReddit,
    telegram: FaTelegram,
    instagram: FaInstagram,
};

export type IconLibrary = typeof iconLibrary;
export type IconName = keyof IconLibrary;
