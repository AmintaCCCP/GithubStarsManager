import { useT } from "../i18n/useT";
import { Button } from './ui/button';
import { Input } from './ui/input';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Save, X, Plus } from 'lucide-react';
import { Modal } from './Modal';
import { Category } from '../types';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useDialog } from '../hooks/useDialog';
import { validateCategoryName } from '../utils/categoryUtils';

// Complete emoji collection for categories
const availableIcons = [
  // 笑脸和人物
  { name: '😀', icon: '😀' },
  { name: '😃', icon: '😃' },
  { name: '😄', icon: '😄' },
  { name: '😁', icon: '😁' },
  { name: '😆', icon: '😆' },
  { name: '😅', icon: '😅' },
  { name: '🤣', icon: '🤣' },
  { name: '😂', icon: '😂' },
  { name: '🙂', icon: '🙂' },
  { name: '🙃', icon: '🙃' },
  { name: '😉', icon: '😉' },
  { name: '😊', icon: '😊' },
  { name: '😇', icon: '😇' },
  { name: '🥰', icon: '🥰' },
  { name: '😍', icon: '😍' },
  { name: '🤩', icon: '🤩' },
  { name: '😘', icon: '😘' },
  { name: '😗', icon: '😗' },
  { name: '😚', icon: '😚' },
  { name: '😙', icon: '😙' },
  { name: '🥲', icon: '🥲' },
  { name: '😋', icon: '😋' },
  { name: '😛', icon: '😛' },
  { name: '😜', icon: '😜' },
  { name: '🤪', icon: '🤪' },
  { name: '😝', icon: '😝' },
  { name: '🤑', icon: '🤑' },
  { name: '🤗', icon: '🤗' },
  { name: '🤭', icon: '🤭' },
  { name: '🤫', icon: '🤫' },
  { name: '🤔', icon: '🤔' },
  { name: '🤐', icon: '🤐' },
  { name: '🤨', icon: '🤨' },
  { name: '😐', icon: '😐' },
  { name: '😑', icon: '😑' },
  { name: '😶', icon: '😶' },
  { name: '😏', icon: '😏' },
  { name: '😒', icon: '😒' },
  { name: '🙄', icon: '🙄' },
  { name: '😬', icon: '😬' },
  { name: '🤥', icon: '🤥' },
  { name: '😔', icon: '😔' },
  { name: '😪', icon: '😪' },
  { name: '🤤', icon: '🤤' },
  { name: '😴', icon: '😴' },
  { name: '😷', icon: '😷' },
  { name: '🤒', icon: '🤒' },
  { name: '🤕', icon: '🤕' },
  { name: '🤢', icon: '🤢' },
  { name: '🤮', icon: '🤮' },
  { name: '🤧', icon: '🤧' },
  { name: '🥵', icon: '🥵' },
  { name: '🥶', icon: '🥶' },
  { name: '🥴', icon: '🥴' },
  { name: '😵', icon: '😵' },
  { name: '🤯', icon: '🤯' },
  { name: '🤠', icon: '🤠' },
  { name: '🥳', icon: '🥳' },
  { name: '🥸', icon: '🥸' },
  { name: '😎', icon: '😎' },
  { name: '🤓', icon: '🤓' },
  { name: '🧐', icon: '🧐' },
  { name: '😕', icon: '😕' },
  { name: '😟', icon: '😟' },
  { name: '🙁', icon: '🙁' },
  { name: '😮', icon: '😮' },
  { name: '😯', icon: '😯' },
  { name: '😲', icon: '😲' },
  { name: '😳', icon: '😳' },
  { name: '🥺', icon: '🥺' },
  { name: '😦', icon: '😦' },
  { name: '😧', icon: '😧' },
  { name: '😨', icon: '😨' },
  { name: '😰', icon: '😰' },
  { name: '😥', icon: '😥' },
  { name: '😢', icon: '😢' },
  { name: '😭', icon: '😭' },
  { name: '😱', icon: '😱' },
  { name: '😖', icon: '😖' },
  { name: '😣', icon: '😣' },
  { name: '😞', icon: '😞' },
  { name: '😓', icon: '😓' },
  { name: '😩', icon: '😩' },
  { name: '😫', icon: '😫' },
  { name: '🥱', icon: '🥱' },
  { name: '😤', icon: '😤' },
  { name: '😡', icon: '😡' },
  { name: '😠', icon: '😠' },
  { name: '🤬', icon: '🤬' },
  { name: '😈', icon: '😈' },
  { name: '👿', icon: '👿' },
  { name: '💀', icon: '💀' },
  { name: '☠️', icon: '☠️' },
  { name: '💩', icon: '💩' },
  { name: '🤡', icon: '🤡' },
  { name: '👹', icon: '👹' },
  { name: '👺', icon: '👺' },
  { name: '👻', icon: '👻' },
  { name: '👽', icon: '👽' },
  { name: '👾', icon: '👾' },
  { name: '🤖', icon: '🤖' },
  
  // 手势和身体部位
  { name: '👋', icon: '👋' },
  { name: '🤚', icon: '🤚' },
  { name: '🖐️', icon: '🖐️' },
  { name: '✋', icon: '✋' },
  { name: '🖖', icon: '🖖' },
  { name: '👌', icon: '👌' },
  { name: '🤌', icon: '🤌' },
  { name: '🤏', icon: '🤏' },
  { name: '✌️', icon: '✌️' },
  { name: '🤞', icon: '🤞' },
  { name: '🤟', icon: '🤟' },
  { name: '🤘', icon: '🤘' },
  { name: '🤙', icon: '🤙' },
  { name: '👈', icon: '👈' },
  { name: '👉', icon: '👉' },
  { name: '👆', icon: '👆' },
  { name: '🖕', icon: '🖕' },
  { name: '👇', icon: '👇' },
  { name: '☝️', icon: '☝️' },
  { name: '👍', icon: '👍' },
  { name: '👎', icon: '👎' },
  { name: '✊', icon: '✊' },
  { name: '👊', icon: '👊' },
  { name: '🤛', icon: '🤛' },
  { name: '🤜', icon: '🤜' },
  { name: '👏', icon: '👏' },
  { name: '🙌', icon: '🙌' },
  { name: '👐', icon: '👐' },
  { name: '🤲', icon: '🤲' },
  { name: '🤝', icon: '🤝' },
  { name: '🙏', icon: '🙏' },
  { name: '✍️', icon: '✍️' },
  { name: '💅', icon: '💅' },
  { name: '🤳', icon: '🤳' },
  { name: '💪', icon: '💪' },
  { name: '🦾', icon: '🦾' },
  { name: '🦿', icon: '🦿' },
  { name: '🦵', icon: '🦵' },
  { name: '🦶', icon: '🦶' },
  { name: '👂', icon: '👂' },
  { name: '🦻', icon: '🦻' },
  { name: '👃', icon: '👃' },
  { name: '🧠', icon: '🧠' },
  { name: '🫀', icon: '🫀' },
  { name: '🫁', icon: '🫁' },
  { name: '🦷', icon: '🦷' },
  { name: '🦴', icon: '🦴' },
  { name: '👀', icon: '👀' },
  { name: '👁️', icon: '👁️' },
  { name: '👅', icon: '👅' },
  { name: '👄', icon: '👄' },
  
  // 人物和职业
  { name: '👶', icon: '👶' },
  { name: '🧒', icon: '🧒' },
  { name: '👦', icon: '👦' },
  { name: '👧', icon: '👧' },
  { name: '🧑', icon: '🧑' },
  { name: '👱', icon: '👱' },
  { name: '👨', icon: '👨' },
  { name: '🧔', icon: '🧔' },
  { name: '👩', icon: '👩' },
  { name: '🧓', icon: '🧓' },
  { name: '👴', icon: '👴' },
  { name: '👵', icon: '👵' },
  { name: '🙍', icon: '🙍' },
  { name: '🙎', icon: '🙎' },
  { name: '🙅', icon: '🙅' },
  { name: '🙆', icon: '🙆' },
  { name: '💁', icon: '💁' },
  { name: '🙋', icon: '🙋' },
  { name: '🧏', icon: '🧏' },
  { name: '🙇', icon: '🙇' },
  { name: '🤦', icon: '🤦' },
  { name: '🤷', icon: '🤷' },
  { name: '👨‍⚕️', icon: '👨‍⚕️' },
  { name: '👩‍⚕️', icon: '👩‍⚕️' },
  { name: '👨‍🌾', icon: '👨‍🌾' },
  { name: '👩‍🌾', icon: '👩‍🌾' },
  { name: '👨‍🍳', icon: '👨‍🍳' },
  { name: '👩‍🍳', icon: '👩‍🍳' },
  { name: '👨‍🎓', icon: '👨‍🎓' },
  { name: '👩‍🎓', icon: '👩‍🎓' },
  { name: '👨‍🎤', icon: '👨‍🎤' },
  { name: '👩‍🎤', icon: '👩‍🎤' },
  { name: '👨‍🏫', icon: '👨‍🏫' },
  { name: '👩‍🏫', icon: '👩‍🏫' },
  { name: '👨‍🏭', icon: '👨‍🏭' },
  { name: '👩‍🏭', icon: '👩‍🏭' },
  { name: '👨‍💻', icon: '👨‍💻' },
  { name: '👩‍💻', icon: '👩‍💻' },
  { name: '👨‍💼', icon: '👨‍💼' },
  { name: '👩‍💼', icon: '👩‍💼' },
  { name: '👨‍🔧', icon: '👨‍🔧' },
  { name: '👩‍🔧', icon: '👩‍🔧' },
  { name: '👨‍🔬', icon: '👨‍🔬' },
  { name: '👩‍🔬', icon: '👩‍🔬' },
  { name: '👨‍🎨', icon: '👨‍🎨' },
  { name: '👩‍🎨', icon: '👩‍🎨' },
  { name: '👨‍🚒', icon: '👨‍🚒' },
  { name: '👩‍🚒', icon: '👩‍🚒' },
  { name: '👨‍✈️', icon: '👨‍✈️' },
  { name: '👩‍✈️', icon: '👩‍✈️' },
  { name: '👨‍🚀', icon: '👨‍🚀' },
  { name: '👩‍🚀', icon: '👩‍🚀' },
  { name: '👨‍⚖️', icon: '👨‍⚖️' },
  { name: '👩‍⚖️', icon: '👩‍⚖️' },
  { name: '👰', icon: '👰' },
  { name: '🤵', icon: '🤵' },
  { name: '👸', icon: '👸' },
  { name: '🤴', icon: '🤴' },
  { name: '🥷', icon: '🥷' },
  { name: '🦸', icon: '🦸' },
  { name: '🦹', icon: '🦹' },
  { name: '🧙', icon: '🧙' },
  { name: '🧚', icon: '🧚' },
  { name: '🧛', icon: '🧛' },
  { name: '🧜', icon: '🧜' },
  { name: '🧝', icon: '🧝' },
  { name: '🧞', icon: '🧞' },
  { name: '🧟', icon: '🧟' },
  { name: '💆', icon: '💆' },
  { name: '💇', icon: '💇' },
  { name: '🚶', icon: '🚶' },
  { name: '🧍', icon: '🧍' },
  { name: '🧎', icon: '🧎' },
  { name: '🏃', icon: '🏃' },
  { name: '💃', icon: '💃' },
  { name: '🕺', icon: '🕺' },
  { name: '🕴️', icon: '🕴️' },
  { name: '👯', icon: '👯' },
  { name: '🧖', icon: '🧖' },
  { name: '🧗', icon: '🧗' },
  { name: '🤺', icon: '🤺' },
  { name: '🏇', icon: '🏇' },
  { name: '⛷️', icon: '⛷️' },
  { name: '🏂', icon: '🏂' },
  { name: '🏌️', icon: '🏌️' },
  { name: '🏄', icon: '🏄' },
  { name: '🚣', icon: '🚣' },
  { name: '🏊', icon: '🏊' },
  { name: '⛹️', icon: '⛹️' },
  { name: '🏋️', icon: '🏋️' },
  { name: '🚴', icon: '🚴' },
  { name: '🚵', icon: '🚵' },
  { name: '🤸', icon: '🤸' },
  { name: '🤼', icon: '🤼' },
  { name: '🤽', icon: '🤽' },
  { name: '🤾', icon: '🤾' },
  { name: '🤹', icon: '🤹' },
  { name: '🧘', icon: '🧘' },
  { name: '🛀', icon: '🛀' },
  { name: '🛌', icon: '🛌' },
  
  // 文件和文档
  { name: '📁', icon: '📁' },
  { name: '📂', icon: '📂' },
  { name: '📄', icon: '📄' },
  { name: '📋', icon: '📋' },
  { name: '📊', icon: '📊' },
  { name: '📈', icon: '📈' },
  { name: '📉', icon: '📉' },
  { name: '📝', icon: '📝' },
  { name: '📚', icon: '📚' },
  { name: '📖', icon: '📖' },
  { name: '📑', icon: '📑' },
  { name: '🗂️', icon: '🗂️' },
  { name: '🗃️', icon: '🗃️' },
  { name: '🗄️', icon: '🗄️' },
  { name: '📇', icon: '📇' },
  
  // 技术和开发
  { name: '💻', icon: '💻' },
  { name: '🖥️', icon: '🖥️' },
  { name: '⌨️', icon: '⌨️' },
  { name: '🖱️', icon: '🖱️' },
  { name: '💾', icon: '💾' },
  { name: '💿', icon: '💿' },
  { name: '📀', icon: '📀' },
  { name: '🔧', icon: '🔧' },
  { name: '🔨', icon: '🔨' },
  { name: '⚙️', icon: '⚙️' },
  { name: '🛠️', icon: '🛠️' },
  { name: '🔩', icon: '🔩' },
  { name: '⚡', icon: '⚡' },
  { name: '🔌', icon: '🔌' },
  { name: '🔋', icon: '🔋' },
  { name: '🖨️', icon: '🖨️' },
  { name: '⌨️', icon: '⌨️' },
  { name: '🖱️', icon: '🖱️' },
  { name: '🖲️', icon: '🖲️' },
  
  // 网络和通信
  { name: '🌐', icon: '🌐' },
  { name: '🌍', icon: '🌍' },
  { name: '🌎', icon: '🌎' },
  { name: '🌏', icon: '🌏' },
  { name: '📡', icon: '📡' },
  { name: '📶', icon: '📶' },
  { name: '📱', icon: '📱' },
  { name: '📞', icon: '📞' },
  { name: '☎️', icon: '☎️' },
  { name: '📧', icon: '📧' },
  { name: '📨', icon: '📨' },
  { name: '📩', icon: '📩' },
  { name: '📬', icon: '📬' },
  { name: '📭', icon: '📭' },
  { name: '📮', icon: '📮' },
  { name: '📪', icon: '📪' },
  { name: '📫', icon: '📫' },
  { name: '📯', icon: '📯' },
  { name: '📢', icon: '📢' },
  { name: '📣', icon: '📣' },
  
  // 多媒体
  { name: '🎵', icon: '🎵' },
  { name: '🎶', icon: '🎶' },
  { name: '🎤', icon: '🎤' },
  { name: '🎧', icon: '🎧' },
  { name: '📻', icon: '📻' },
  { name: '📺', icon: '📺' },
  { name: '📹', icon: '📹' },
  { name: '📷', icon: '📷' },
  { name: '📸', icon: '📸' },
  { name: '🎥', icon: '🎥' },
  { name: '🎬', icon: '🎬' },
  { name: '🎭', icon: '🎭' },
  { name: '🎨', icon: '🎨' },
  { name: '🖌️', icon: '🖌️' },
  { name: '🖍️', icon: '🖍️' },
  { name: '✏️', icon: '✏️' },
  { name: '✒️', icon: '✒️' },
  { name: '🖊️', icon: '🖊️' },
  { name: '🖋️', icon: '🖋️' },
  { name: '🖍️', icon: '🖍️' },
  { name: '📐', icon: '📐' },
  { name: '📏', icon: '📏' },
  { name: '📌', icon: '📌' },
  { name: '📍', icon: '📍' },
  { name: '🖋️', icon: '🖋️' },
  
  // 游戏和娱乐
  { name: '🎮', icon: '🎮' },
  { name: '🕹️', icon: '🕹️' },
  { name: '🎯', icon: '🎯' },
  { name: '🎲', icon: '🎲' },
  { name: '🃏', icon: '🃏' },
  { name: '🎰', icon: '🎰' },
  { name: '🎪', icon: '🎪' },
  { name: '🎨', icon: '🎨' },
  { name: '🎭', icon: '🎭' },
  { name: '🎪', icon: '🎪' },
  { name: '🎨', icon: '🎨' },
  
  // 安全和保护
  // 安全和保护
  { name: '🔒', icon: '🔒' },
  { name: '🔓', icon: '🔓' },
  { name: '🔐', icon: '🔐' },
  { name: '🔑', icon: '🔑' },
  { name: '🗝️', icon: '🗝️' },
  { name: '🛡️', icon: '🛡️' },
  { name: '🔰', icon: '🔰' },
  { name: '⚔️', icon: '⚔️' },
  
  // 搜索和导航
  { name: '🔍', icon: '🔍' },
  { name: '🔎', icon: '🔎' },
  { name: '🧭', icon: '🧭' },
  { name: '🗺️', icon: '🗺️' },
  { name: '📍', icon: '📍' },
  { name: '📌', icon: '📌' },
  { name: '📎', icon: '📎' },
  { name: '🔗', icon: '🔗' },
  { name: '⛓️', icon: '⛓️' },
  { name: '🧭', icon: '🧭' },
  
  // 云和存储
  { name: '☁️', icon: '☁️' },
  { name: '⛅', icon: '⛅' },
  { name: '🌤️', icon: '🌤️' },
  { name: '📦', icon: '📦' },
  { name: '📫', icon: '📫' },
  { name: '🗳️', icon: '🗳️' },
  { name: '🗂️', icon: '🗂️' },
  { name: '🗃️', icon: '🗃️' },
  { name: '🗄️', icon: '🗄️' },
  { name: '🗑️', icon: '🗑️' },
  
  // 人物和社交
  { name: '👤', icon: '👤' },
  { name: '👥', icon: '👥' },
  { name: '👨‍💻', icon: '👨‍💻' },
  { name: '👩‍💻', icon: '👩‍💻' },
  { name: '🤖', icon: '🤖' },
  { name: '👾', icon: '👾' },
  { name: '👥', icon: '👥' },
  { name: '👪', icon: '👪' },
  { name: '👫', icon: '👫' },
  { name: '👬', icon: '👬' },
  
  // 符号和标记
  { name: '⭐', icon: '⭐' },
  { name: '🌟', icon: '🌟' },
  { name: '✨', icon: '✨' },
  { name: '💫', icon: '💫' },
  { name: '❤️', icon: '❤️' },
  { name: '💙', icon: '💙' },
  { name: '💚', icon: '💚' },
  { name: '💛', icon: '💛' },
  { name: '🧡', icon: '🧡' },
  { name: '💜', icon: '💜' },
  { name: '🖤', icon: '🖤' },
  { name: '🤍', icon: '🤍' },
  { name: '💯', icon: '💯' },
  { name: '✅', icon: '✅' },
  { name: '❌', icon: '❌' },
  { name: '⚠️', icon: '⚠️' },
  { name: '🚀', icon: '🚀' },
  { name: '🎉', icon: '🎉' },
  { name: '🎊', icon: '🎊' },
  { name: '🔥', icon: '🔥' },
  { name: '💎', icon: '💎' },
  { name: '🏆', icon: '🏆' },
  { name: '🥇', icon: '🥇' },
  { name: '🥈', icon: '🥈' },
  { name: '🥉', icon: '🥉' },
  { name: '🏅', icon: '🏅' },
  
  // 箭头和方向
  { name: '⬆️', icon: '⬆️' },
  { name: '⬇️', icon: '⬇️' },
  { name: '⬅️', icon: '⬅️' },
  { name: '➡️', icon: '➡️' },
  { name: '↗️', icon: '↗️' },
  { name: '↘️', icon: '↘️' },
  { name: '↙️', icon: '↙️' },
  { name: '↖️', icon: '↖️' },
  { name: '🔄', icon: '🔄' },
  { name: '🔃', icon: '🔃' },
  { name: '🔁', icon: '🔁' },
  { name: '🔂', icon: '🔂' },
  { name: '⤴️', icon: '⤴️' },
  { name: '⤵️', icon: '⤵️' },
  { name: '🔀', icon: '🔀' },
  { name: '🔄', icon: '🔄' },
  { name: '🔃', icon: '🔃' },
  { name: '🔁', icon: '🔁' },
  { name: '🔂', icon: '🔂' },
  { name: '▶️', icon: '▶️' },
  
  // 其他常用
  { name: '📅', icon: '📅' },
  { name: '📆', icon: '📆' },
  { name: '🗓️', icon: '🗓️' },
  { name: '⏰', icon: '⏰' },
  { name: '⏱️', icon: '⏱️' },
  { name: '⏲️', icon: '⏲️' },
  { name: '🕐', icon: '🕐' },
  { name: '📐', icon: '📐' },
  { name: '📏', icon: '📏' },
  { name: '♻️', icon: '♻️' },
  { name: '🔄', icon: '🔄' },
  { name: '➕', icon: '➕' },
  { name: '➖', icon: '➖' },
  { name: '✖️', icon: '✖️' },
  { name: '➗', icon: '➗' },
  { name: '🟢', icon: '🟢' },
  { name: '🔴', icon: '🔴' },
  { name: '🟡', icon: '🟡' },
  { name: '🔵', icon: '🔵' },
  { name: '🟣', icon: '🟣' },
  { name: '🟠', icon: '🟠' },
  { name: '⚫', icon: '⚫' },
  { name: '⚪', icon: '⚪' },
  
  // 动物和自然
  { name: '🐶', icon: '🐶' },
  { name: '🐱', icon: '🐱' },
  { name: '🐭', icon: '🐭' },
  { name: '🐹', icon: '🐹' },
  { name: '🐰', icon: '🐰' },
  { name: '🦊', icon: '🦊' },
  { name: '🐻', icon: '🐻' },
  { name: '🐼', icon: '🐼' },
  { name: '🐨', icon: '🐨' },
  { name: '🐯', icon: '🐯' },
  { name: '🦁', icon: '🦁' },
  { name: '🐮', icon: '🐮' },
  { name: '🐷', icon: '🐷' },
  { name: '🐽', icon: '🐽' },
  { name: '🐸', icon: '🐸' },
  { name: '🐵', icon: '🐵' },
  { name: '🙈', icon: '🙈' },
  { name: '🙉', icon: '🙉' },
  { name: '🙊', icon: '🙊' },
  { name: '🐒', icon: '🐒' },
  { name: '🐔', icon: '🐔' },
  { name: '🐧', icon: '🐧' },
  { name: '🐦', icon: '🐦' },
  { name: '🐤', icon: '🐤' },
  { name: '🐣', icon: '🐣' },
  { name: '🐥', icon: '🐥' },
  { name: '🦆', icon: '🦆' },
  { name: '🦅', icon: '🦅' },
  { name: '🦉', icon: '🦉' },
  { name: '🦇', icon: '🦇' },
  { name: '🐺', icon: '🐺' },
  { name: '🐗', icon: '🐗' },
  { name: '🐴', icon: '🐴' },
  { name: '🦄', icon: '🦄' },
  { name: '🐝', icon: '🐝' },
  { name: '🐛', icon: '🐛' },
  { name: '🦋', icon: '🦋' },
  { name: '🐌', icon: '🐌' },
  { name: '🐞', icon: '🐞' },
  { name: '🐜', icon: '🐜' },
  { name: '🦟', icon: '🦟' },
  { name: '🦗', icon: '🦗' },
  { name: '🕷️', icon: '🕷️' },
  { name: '🕸️', icon: '🕸️' },
  { name: '🦂', icon: '🦂' },
  { name: '🐢', icon: '🐢' },
  { name: '🐍', icon: '🐍' },
  { name: '🦎', icon: '🦎' },
  { name: '🦖', icon: '🦖' },
  { name: '🦕', icon: '🦕' },
  { name: '🐙', icon: '🐙' },
  { name: '🦑', icon: '🦑' },
  { name: '🦐', icon: '🦐' },
  { name: '🦞', icon: '🦞' },
  { name: '🦀', icon: '🦀' },
  { name: '🐡', icon: '🐡' },
  { name: '🐠', icon: '🐠' },
  { name: '🐟', icon: '🐟' },
  { name: '🐬', icon: '🐬' },
  { name: '🐳', icon: '🐳' },
  { name: '🐋', icon: '🐋' },
  { name: '🦈', icon: '🦈' },
  { name: '🐊', icon: '🐊' },
  { name: '🐅', icon: '🐅' },
  { name: '🐆', icon: '🐆' },
  { name: '🦓', icon: '🦓' },
  { name: '🦍', icon: '🦍' },
  { name: '🦧', icon: '🦧' },
  { name: '🐘', icon: '🐘' },
  { name: '🦛', icon: '🦛' },
  { name: '🦏', icon: '🦏' },
  { name: '🐪', icon: '🐪' },
  { name: '🐫', icon: '🐫' },
  { name: '🦒', icon: '🦒' },
  { name: '🦘', icon: '🦘' },
  { name: '🐃', icon: '🐃' },
  { name: '🐂', icon: '🐂' },
  { name: '🐄', icon: '🐄' },
  { name: '🐎', icon: '🐎' },
  { name: '🐖', icon: '🐖' },
  { name: '🐏', icon: '🐏' },
  { name: '🐑', icon: '🐑' },
  { name: '🦙', icon: '🦙' },
  { name: '🐐', icon: '🐐' },
  { name: '🦌', icon: '🦌' },
  { name: '🐕', icon: '🐕' },
  { name: '🐩', icon: '🐩' },
  { name: '🦮', icon: '🦮' },
  { name: '🐕‍🦺', icon: '🐕‍🦺' },
  { name: '🐈', icon: '🐈' },
  { name: '🐈‍⬛', icon: '🐈‍⬛' },
  { name: '🐓', icon: '🐓' },
  { name: '🦃', icon: '🦃' },
  { name: '🦚', icon: '🦚' },
  { name: '🦜', icon: '🦜' },
  { name: '🦢', icon: '🦢' },
  { name: '🦩', icon: '🦩' },
  { name: '🕊️', icon: '🕊️' },
  { name: '🐇', icon: '🐇' },
  { name: '🦝', icon: '🦝' },
  { name: '🦨', icon: '🦨' },
  { name: '🦡', icon: '🦡' },
  { name: '🦦', icon: '🦦' },
  { name: '🦥', icon: '🦥' },
  { name: '🐁', icon: '🐁' },
  { name: '🐀', icon: '🐀' },
  { name: '🐿️', icon: '🐿️' },
  { name: '🦔', icon: '🦔' },
  
  // 植物和食物
  { name: '🌲', icon: '🌲' },
  { name: '🌳', icon: '🌳' },
  { name: '🌴', icon: '🌴' },
  { name: '🌵', icon: '🌵' },
  { name: '🌶️', icon: '🌶️' },
  { name: '🍄', icon: '🍄' },
  { name: '🌰', icon: '🌰' },
  { name: '🌱', icon: '🌱' },
  { name: '🌿', icon: '🌿' },
  { name: '☘️', icon: '☘️' },
  { name: '🍀', icon: '🍀' },
  { name: '🎋', icon: '🎋' },
  { name: '🎍', icon: '🎍' },
  { name: '🍎', icon: '🍎' },
  { name: '🍊', icon: '🍊' },
  { name: '🍋', icon: '🍋' },
  { name: '🍌', icon: '🍌' },
  { name: '🍉', icon: '🍉' },
  { name: '🍇', icon: '🍇' },
  { name: '🍓', icon: '🍓' },
  { name: '🫐', icon: '🫐' },
  { name: '🍈', icon: '🍈' },
  { name: '🍒', icon: '🍒' },
  { name: '🍑', icon: '🍑' },
  { name: '🥭', icon: '🥭' },
  { name: '🍍', icon: '🍍' },
  { name: '🥥', icon: '🥥' },
  { name: '🥝', icon: '🥝' },
  { name: '🍅', icon: '🍅' },
  { name: '🍆', icon: '🍆' },
  { name: '🥑', icon: '🥑' },
  { name: '🥦', icon: '🥦' },
  { name: '🥬', icon: '🥬' },
  { name: '🥒', icon: '🥒' },
  { name: '🌶️', icon: '🌶️' },
  { name: '🫑', icon: '🫑' },
  { name: '🌽', icon: '🌽' },
  { name: '🥕', icon: '🥕' },
  { name: '🫒', icon: '🫒' },
  { name: '🧄', icon: '🧄' },
  { name: '🧅', icon: '🧅' },
  { name: '🥔', icon: '🥔' },
  { name: '🍠', icon: '🍠' },
  { name: '🥐', icon: '🥐' },
  { name: '🥖', icon: '🥖' },
  { name: '🍞', icon: '🍞' },
  { name: '🥨', icon: '🥨' },
  { name: '🥯', icon: '🥯' },
  { name: '🥞', icon: '🥞' },
  { name: '🧇', icon: '🧇' },
  { name: '🧀', icon: '🧀' },
  { name: '🍖', icon: '🍖' },
  { name: '🍗', icon: '🍗' },
  { name: '🥩', icon: '🥩' },
  { name: '🥓', icon: '🥓' },
  { name: '🍔', icon: '🍔' },
  { name: '🍟', icon: '🍟' },
  { name: '🍕', icon: '🍕' },
  { name: '🌭', icon: '🌭' },
  { name: '🥪', icon: '🥪' },
  { name: '🌮', icon: '🌮' },
  { name: '🌯', icon: '🌯' },
  { name: '🫔', icon: '🫔' },
  { name: '🥙', icon: '🥙' },
  { name: '🧆', icon: '🧆' },
  { name: '🥚', icon: '🥚' },
  { name: '🍳', icon: '🍳' },
  { name: '🥘', icon: '🥘' },
  { name: '🍲', icon: '🍲' },
  { name: '🫕', icon: '🫕' },
  { name: '🥣', icon: '🥣' },
  { name: '🥗', icon: '🥗' },
  { name: '🍿', icon: '🍿' },
  { name: '🧈', icon: '🧈' },
  { name: '🧂', icon: '🧂' },
  { name: '🥫', icon: '🥫' },
  { name: '🍱', icon: '🍱' },
  { name: '🍘', icon: '🍘' },
  { name: '🍙', icon: '🍙' },
  { name: '🍚', icon: '🍚' },
  { name: '🍛', icon: '🍛' },
  { name: '🍜', icon: '🍜' },
  { name: '🍝', icon: '🍝' },
  { name: '🍠', icon: '🍠' },
  { name: '🍢', icon: '🍢' },
  { name: '🍣', icon: '🍣' },
  { name: '🍤', icon: '🍤' },
  { name: '🍥', icon: '🍥' },
  { name: '🥮', icon: '🥮' },
  { name: '🍡', icon: '🍡' },
  { name: '🥟', icon: '🥟' },
  { name: '🥠', icon: '🥠' },
  { name: '🥡', icon: '🥡' },
  
  // 交通工具
  { name: '🚗', icon: '🚗' },
  { name: '🚕', icon: '🚕' },
  { name: '🚙', icon: '🚙' },
  { name: '🚌', icon: '🚌' },
  { name: '🚎', icon: '🚎' },
  { name: '🏎️', icon: '🏎️' },
  { name: '🚓', icon: '🚓' },
  { name: '🚑', icon: '🚑' },
  { name: '🚒', icon: '🚒' },
  { name: '🚐', icon: '🚐' },
  { name: '🛻', icon: '🛻' },
  { name: '🚚', icon: '🚚' },
  { name: '🚛', icon: '🚛' },
  { name: '🚜', icon: '🚜' },
  { name: '🏍️', icon: '🏍️' },
  { name: '🛵', icon: '🛵' },
  { name: '🚲', icon: '🚲' },
  { name: '🛴', icon: '🛴' },
  { name: '🛹', icon: '🛹' },
  { name: '🛼', icon: '🛼' },
  { name: '🚁', icon: '🚁' },
  { name: '🛸', icon: '🛸' },
  { name: '✈️', icon: '✈️' },
  { name: '🛩️', icon: '🛩️' },
  { name: '🛫', icon: '🛫' },
  { name: '🛬', icon: '🛬' },
  { name: '🪂', icon: '🪂' },
  { name: '💺', icon: '💺' },
  { name: '🚀', icon: '🚀' },
  { name: '🛰️', icon: '🛰️' },
  { name: '🚉', icon: '🚉' },
  { name: '🚞', icon: '🚞' },
  { name: '🚝', icon: '🚝' },
  { name: '🚄', icon: '🚄' },
  { name: '🚅', icon: '🚅' },
  { name: '🚈', icon: '🚈' },
  { name: '🚂', icon: '🚂' },
  { name: '🚆', icon: '🚆' },
  { name: '🚇', icon: '🚇' },
  { name: '🚊', icon: '🚊' },
  { name: '🚋', icon: '🚋' },
  { name: '🚃', icon: '🚃' },
  { name: '🚋', icon: '🚋' },
  { name: '🚎', icon: '🚎' },
  { name: '🚐', icon: '🚐' },
  { name: '🚑', icon: '🚑' },
  { name: '🚒', icon: '🚒' },
  { name: '🚓', icon: '🚓' },
  { name: '🚔', icon: '🚔' },
  { name: '🚕', icon: '🚕' },
  { name: '🚖', icon: '🚖' },
  { name: '🚗', icon: '🚗' },
  { name: '🚘', icon: '🚘' },
  { name: '🚙', icon: '🚙' },
  { name: '🛻', icon: '🛻' },
  { name: '🚚', icon: '🚚' },
  { name: '🚛', icon: '🚛' },
  { name: '🚜', icon: '🚜' },
  { name: '🏎️', icon: '🏎️' },
  { name: '🏍️', icon: '🏍️' },
  { name: '🛵', icon: '🛵' },
  { name: '🦽', icon: '🦽' },
  { name: '🦼', icon: '🦼' },
  { name: '🛺', icon: '🛺' },
  { name: '🚲', icon: '🚲' },
  { name: '🛴', icon: '🛴' },
  { name: '🛹', icon: '🛹' },
  { name: '🛼', icon: '🛼' },
  { name: '🚏', icon: '🚏' },
  { name: '🛣️', icon: '🛣️' },
  { name: '🛤️', icon: '🛤️' },
  { name: '🛢️', icon: '🛢️' },
  { name: '⛽', icon: '⛽' },
  { name: '🚨', icon: '🚨' },
  { name: '🚥', icon: '🚥' },
  { name: '🚦', icon: '🚦' },
  { name: '🛑', icon: '🛑' },
  { name: '🚧', icon: '🚧' },
  { name: '⚓', icon: '⚓' },
  { name: '⛵', icon: '⛵' },
  { name: '🛶', icon: '🛶' },
  { name: '🚤', icon: '🚤' },
  { name: '🛳️', icon: '🛳️' },
  { name: '⛴️', icon: '⛴️' },
  { name: '🚢', icon: '🚢' },
];

const uniqueAvailableIcons = Array.from(new Map(availableIcons.map((icon) => [icon.name, icon])).values());

interface CategoryEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  category: Category | null;
  isCreating?: boolean;
}

export const CategoryEditModal: React.FC<CategoryEditModalProps> = ({
  isOpen,
  onClose,
  category,
  isCreating = false
}) => {
  const { addCustomCategory, updateCustomCategory, updateDefaultCategory, resetDefaultCategory, resetDefaultCategoryNameIcon, resetDefaultCategoryKeywords, defaultCategoryOverrides, language, customCategories } = useAppStore(useShallow((state) => ({
    addCustomCategory: state.addCustomCategory,
    updateCustomCategory: state.updateCustomCategory,
    updateDefaultCategory: state.updateDefaultCategory,
    resetDefaultCategory: state.resetDefaultCategory,
    resetDefaultCategoryNameIcon: state.resetDefaultCategoryNameIcon,
    resetDefaultCategoryKeywords: state.resetDefaultCategoryKeywords,
    defaultCategoryOverrides: state.defaultCategoryOverrides,
    language: state.language,
    customCategories: state.customCategories,
  })));

  const { toast } = useDialog();
  const t = useT('app');

  const originalDefaultCategories = getAllCategories([], language, [], {});
  const isDefaultCategoryModified = category && !category.isCustom && category.id in defaultCategoryOverrides;
  const originalCategory = category && !category.isCustom ? originalDefaultCategories.find(c => c.id === category.id) : null;
  
  const effectiveCategory = React.useMemo(() => {
    if (!category || isCreating) return null;
    if (category.isCustom) {
      return customCategories.find(c => c.id === category.id) || category;
    }
    const allCategories = getAllCategories([], language, [], defaultCategoryOverrides);
    return allCategories.find(c => c.id === category.id) || category;
  }, [category, isCreating, customCategories, defaultCategoryOverrides, language]);
  
  const hasNameIconModified = category && !category.isCustom && defaultCategoryOverrides[category.id] && 
    (defaultCategoryOverrides[category.id].name !== undefined || defaultCategoryOverrides[category.id].icon !== undefined);
  const hasKeywordsModified = category && !category.isCustom && defaultCategoryOverrides[category.id] && 
    defaultCategoryOverrides[category.id].keywords !== undefined;
  
  const [formData, setFormData] = useState({
    name: '',
    icon: 'Folder',
    keywords: ''
  });
  const [customIcon, setCustomIcon] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  useEffect(() => {
    if (category && !isCreating) {
      setFormData({
        name: category.name,
        icon: category.icon,
        keywords: category.keywords.join(', ')
      });
    } else if (isCreating) {
      setFormData({
        name: '',
        icon: '📁',
        keywords: ''
      });
    }
  }, [category, isCreating, isOpen]);

  const handleSave = () => {
    const validation = validateCategoryName(formData.name, t);
    if (validation.error !== null) {
      toast(validation.error, 'error');
      return;
    }
    const categoryName = validation.value;

    if (isCreating) {
      const categoryData: Category = {
        id: Date.now().toString(),
        name: categoryName,
        icon: formData.icon,
        keywords: formData.keywords.split(',').map(k => k.trim()).filter(k => k),
        isCustom: true
      };
      addCustomCategory(categoryData);
    } else if (category) {
      const updates = {
        name: categoryName,
        icon: formData.icon,
        keywords: formData.keywords.split(',').map(k => k.trim()).filter(k => k),
      };
      if (category.isCustom) {
        updateCustomCategory(category.id, updates);
      } else {
        updateDefaultCategory(category.id, updates);
      }
    }

    onClose();
  };

  const hasChanges = isCreating 
    ? formData.name.trim().length > 0
    : effectiveCategory && (
        formData.name !== effectiveCategory.name ||
        formData.icon !== effectiveCategory.icon ||
        formData.keywords !== (effectiveCategory.keywords?.join(', ') || '')
      );

  const handleIconSelect = useCallback((iconValue: string) => {
    setFormData(prev => ({ ...prev, icon: iconValue }));
    setShowCustomInput(false);
    setCustomIcon('');
  }, []);

  const iconGrid = useMemo(() => uniqueAvailableIcons.map((iconItem) => (
    <Button
      key={iconItem.name}
      variant="ghost"
      aria-pressed={formData.icon === iconItem.icon}
      onClick={() => handleIconSelect(iconItem.icon)}
      className={`p-2 rounded-lg text-xl hover:bg-muted dark:hover:bg-accent transition-colors ${
        formData.icon === iconItem.icon
          ? 'bg-primary/20 dark:bg-primary/30 ring-2 ring-ring'
          : 'bg-background dark:bg-muted/40'
      }`}
      title={iconItem.icon}
    >
      {iconItem.icon}
    </Button>
  )), [formData.icon, handleIconSelect]);

  const handleCustomIconSubmit = () => {
    if (customIcon.trim()) {
      setFormData(prev => ({ ...prev, icon: customIcon.trim() }));
      setShowCustomInput(false);
      setCustomIcon('');
    }
  };

  const handleClose = () => {
    setFormData({
      name: '',
      icon: 'Folder',
      keywords: ''
    });
    setCustomIcon('');
    setShowCustomInput(false);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isCreating ? t('categoryEditModal.add-category') : t('categoryEditModal.edit-category')}
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        {/* Category Name */}
        <div>
          <label htmlFor="category-name" className="block text-sm font-medium text-foreground dark:text-foreground mb-2">
            {t('categoryEditModal.category-name')} *
          </label>
          <Input
            id="category-name"
            type="text"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-card dark:bg-muted/40 text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
            placeholder={t('categoryEditModal.enter-category-name')}
            autoFocus
          />
        </div>

        {/* Icon Selection */}
        <div>
          <label className="block text-sm font-medium text-foreground dark:text-foreground mb-2">
            {t('categoryEditModal.select-icon')} 
            <span className="text-xs text-muted-foreground dark:text-muted-foreground ml-2">
              ({uniqueAvailableIcons.length}+ {t('categoryEditModal.available')})
            </span>
          </label>
          
          {/* Custom Icon Input */}
          {showCustomInput && (
            <div className="mb-3 p-3 bg-muted dark:bg-primary/10 border border-border dark:border-primary/20 rounded-lg">
              <div className="flex items-center space-x-2">
                <Input
                  aria-label={t('categoryEditModal.custom-icon')}
                  type="text"
                  value={customIcon}
                  onChange={(e) => setCustomIcon(e.target.value)}
                  placeholder={t('categoryEditModal.enter-any-emoji')}
                  className="flex-1 px-3 py-2 border border-border dark:border-border rounded-lg bg-card dark:bg-muted/40 text-foreground dark:text-foreground text-center text-lg"
                  autoFocus
                />
                <Button
                  onClick={handleCustomIconSubmit}
                  disabled={!customIcon.trim()}
                  className="px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 dark:bg-primary/80 dark:hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('categoryEditModal.ok')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowCustomInput(false);
                    setCustomIcon('');
                  }}
                  className="px-3 py-2 bg-muted hover:bg-accent dark:hover:bg-accent text-foreground dark:text-foreground rounded-lg border border-border dark:bg-accent dark:hover:bg-accent dark:text-muted-foreground"
                >
                  {t('categoryEditModal.cancel')}
                </Button>
              </div>
              <p className="text-xs text-primary dark:text-primary mt-2">
                {t('categoryEditModal.tip-you-can-enter-any-emoji-like-etc')}
              </p>
            </div>
          )}
          
          <div className="grid grid-cols-8 gap-2 max-h-64 overflow-y-auto border border-border dark:border-border rounded-lg p-3">
            {iconGrid}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground dark:text-muted-foreground">
            <span className="whitespace-nowrap">{t('categoryEditModal.selected')} {formData.icon}</span>
            <Button
              type="button"
              onClick={() => setShowCustomInput(true)}
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2 py-1 text-sm text-primary dark:text-primary hover:underline"
            >
              <Plus className="h-3 w-3" />
              {t('categoryEditModal.custom-emoji')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
            {t('categoryEditModal.includes-all-common-emoji-categories-smileys-peo')}
          </p>
        </div>

        {/* Keywords */}
        <div>
          <label htmlFor="category-keywords" className="block text-sm font-medium text-foreground dark:text-foreground mb-2">
            {t('categoryEditModal.keywords')}
          </label>
          <Input
            id="category-keywords"
            type="text"
            value={formData.keywords}
            onChange={(e) => setFormData(prev => ({ ...prev, keywords: e.target.value }))}
            className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-card dark:bg-muted/40 text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
            placeholder={t('categoryEditModal.comma-separated-keywords')}
          />
          <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
            {t('categoryEditModal.used-to-automatically-match-repositories-to-this')}
          </p>
        </div>

        {/* Default Category Modified Hint */}
        {category && !category.isCustom && isDefaultCategoryModified && originalCategory && (
          <div className="p-3 bg-muted dark:bg-warning/10 rounded-lg border border-border dark:border-warning/20">
            <p className="text-xs text-warning mb-2">
              {t('categoryEditModal.this-default-category-has-been-modified-original', { v1: originalCategory.icon, v2: originalCategory.name })}
            </p>
            <div className="flex items-center space-x-2">
              <span className="text-xs text-warning">{t('categoryEditModal.reset')}</span>
              {hasNameIconModified && (
                <Button
                  size="sm"
                  onClick={() => {
                    resetDefaultCategoryNameIcon(category.id);
                    setFormData(prev => ({
                      ...prev,
                      name: originalCategory.name,
                      icon: originalCategory.icon
                    }));
                  }}
                  className="text-xs px-2 py-1 bg-muted text-muted-foreground dark:bg-warning/20 dark:text-warning rounded hover:bg-accent dark:hover:bg-warning/30 transition-colors"
                >
                  {t('categoryEditModal.name-icon')}
                </Button>
              )}
              {hasKeywordsModified && (
                <Button
                  size="sm"
                  onClick={() => {
                    resetDefaultCategoryKeywords(category.id);
                    setFormData(prev => ({
                      ...prev,
                      keywords: originalCategory.keywords.join(', ')
                    }));
                  }}
                  className="text-xs px-2 py-1 bg-muted text-muted-foreground dark:bg-warning/20 dark:text-warning rounded hover:bg-accent dark:hover:bg-warning/30 transition-colors"
                >
                  {t('categoryEditModal.keywords')}
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  resetDefaultCategory(category.id);
                  setFormData({
                    name: originalCategory.name,
                    icon: originalCategory.icon,
                    keywords: originalCategory.keywords.join(', ')
                  });
                }}
                className="text-xs px-2 py-1 bg-muted text-muted-foreground dark:bg-destructive/20 dark:text-destructive rounded hover:bg-accent dark:hover:bg-destructive/30 transition-colors"
              >
                {t('categoryEditModal.all')}
              </Button>
            </div>
          </div>
        )}

        {category && !category.isCustom && !isDefaultCategoryModified && (
          <div className="p-3 bg-muted dark:bg-primary/10 rounded-lg border border-primary/20">
            <p className="text-xs text-primary dark:text-primary">
              {t('categoryEditModal.editing-default-category-will-override-original')}
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end space-x-3 pt-4 border-t dark:border-border mt-4">
          <Button
            variant="outline"
            onClick={handleClose}
            className="flex items-center space-x-2 px-4 py-2 text-foreground dark:text-foreground bg-muted dark:bg-muted/40 rounded-lg hover:bg-accent dark:hover:bg-accent dark:border dark:border-border transition-colors"
          >
            <X className="w-4 h-4" />
            <span>{t('categoryEditModal.cancel')}</span>
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${hasChanges ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-muted text-muted-foreground dark:bg-card/5 dark:text-muted-foreground cursor-not-allowed'}`}
          >
            <Save className="w-4 h-4" />
            <span>{t('categoryEditModal.save')}</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
};